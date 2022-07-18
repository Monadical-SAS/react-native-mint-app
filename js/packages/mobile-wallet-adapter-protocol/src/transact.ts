import createHelloReq from './createHelloReq';
import { SEQUENCE_NUMBER_BYTES } from './createSequenceNumberVector';
import {
    SolanaMobileWalletAdapterError,
    SolanaMobileWalletAdapterErrorCode,
    SolanaMobileWalletAdapterProtocolError,
} from './errors';
import generateAssociationKeypair from './generateAssociationKeypair';
import generateECDHKeypair from './generateECDHKeypair';
import { decryptJsonRpcMessage, encryptJsonRpcMessage } from './jsonRpcMessage';
import parseHelloRsp, { SharedSecret } from './parseHelloRsp';
import { startSession } from './startSession';
import { AssociationKeypair, MobileWallet, WalletAssociationConfig } from './types';

const WEBSOCKET_CONNECTION_CONFIG = {
    maxAttempts: 34,
    /**
     * 300 milliseconds is a generally accepted threshold for what someone
     * would consider an acceptable response time for a user interface
     * after having performed a low-attention tapping task. We set the
     * interval at which we wait for the wallet to set up the websocket at
     * half this, as per the Nyquist frequency.
     */
    retryDelayMs: 150,
} as const;
const WEBSOCKET_PROTOCOL = 'com.solana.mobilewalletadapter.v1';

type JsonResponsePromises<T> = Record<
    number,
    Readonly<{ resolve: (value?: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void }>
>;

type State =
    | { __type: 'connected'; sharedSecret: SharedSecret }
    | { __type: 'connecting'; associationKeypair: AssociationKeypair }
    | { __type: 'disconnected' }
    | { __type: 'hello_req_sent'; associationPublicKey: CryptoKey; ecdhPrivateKey: CryptoKey };

function assertSecureContext() {
    if (typeof window === 'undefined' || window.isSecureContext !== true) {
        throw new SolanaMobileWalletAdapterError(
            SolanaMobileWalletAdapterErrorCode.ERROR_SECURE_CONTEXT_REQUIRED,
            'The mobile wallet adapter protocol must be used in a secure context (`https`).',
        );
    }
}

function getSequenceNumberFromByteArray(byteArray: ArrayBuffer): number {
    const view = new DataView(byteArray);
    return view.getUint32(0, /* littleEndian */ false);
}

export async function transact<TReturn>(
    callback: (wallet: MobileWallet) => TReturn,
    config?: WalletAssociationConfig,
): Promise<TReturn> {
    assertSecureContext();
    const associationKeypair = await generateAssociationKeypair();
    const sessionPort = await startSession(associationKeypair.publicKey, config?.baseUri);
    const websocketURL = `ws://localhost:${sessionPort}/solana-wallet`;
    let nextJsonRpcMessageId = 1;
    let lastKnownInboundSequenceNumber = 0;
    let state: State = { __type: 'disconnected' };
    return new Promise((resolve, reject) => {
        let attempts = 0;
        let socket: WebSocket;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonRpcResponsePromises: JsonResponsePromises<any> = {};
        const handleOpen = async () => {
            if (state.__type !== 'connecting') {
                console.warn(
                    'Expected adapter state to be `connecting` at the moment the websocket opens. ' +
                        `Got \`${state.__type}\`.`,
                );
                return;
            }
            const { associationKeypair } = state;
            socket.removeEventListener('open', handleOpen);
            const ecdhKeypair = await generateECDHKeypair();
            socket.send(await createHelloReq(ecdhKeypair.publicKey, associationKeypair.privateKey));
            state = {
                __type: 'hello_req_sent',
                associationPublicKey: associationKeypair.publicKey,
                ecdhPrivateKey: ecdhKeypair.privateKey,
            };
        };
        const handleClose = (evt: CloseEvent) => {
            if (evt.wasClean) {
                state = { __type: 'disconnected' };
            } else {
                reject(
                    new SolanaMobileWalletAdapterError(
                        SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_CLOSED,
                        `The wallet session dropped unexpectedly (${evt.code}: ${evt.reason}).`,
                        { closeEvent: evt },
                    ),
                );
            }
            disposeSocket();
        };
        const handleError = async (_evt: Event) => {
            disposeSocket();
            if (++attempts >= WEBSOCKET_CONNECTION_CONFIG.maxAttempts) {
                reject(
                    new SolanaMobileWalletAdapterError(
                        SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_ESTABLISHMENT_FAILED,
                        `Failed to connect to the wallet websocket on port ${sessionPort}.`,
                        { port: sessionPort },
                    ),
                );
            } else {
                await new Promise((resolve) => {
                    retryWaitTimeoutId = window.setTimeout(resolve, WEBSOCKET_CONNECTION_CONFIG.retryDelayMs);
                });
                attemptSocketConnection();
            }
        };
        const handleMessage = async (evt: MessageEvent<Blob>) => {
            const responseBuffer = await evt.data.arrayBuffer();
            switch (state.__type) {
                case 'connected':
                    try {
                        const sequenceNumberVector = responseBuffer.slice(0, SEQUENCE_NUMBER_BYTES);
                        const sequenceNumber = getSequenceNumberFromByteArray(sequenceNumberVector);
                        if (sequenceNumber <= lastKnownInboundSequenceNumber) {
                            throw new Error('Encrypted message has invalid sequence number');
                        }
                        lastKnownInboundSequenceNumber = sequenceNumber;
                        const jsonRpcMessage = await decryptJsonRpcMessage(responseBuffer, state.sharedSecret);
                        const responsePromise = jsonRpcResponsePromises[jsonRpcMessage.id];
                        delete jsonRpcResponsePromises[jsonRpcMessage.id];
                        responsePromise.resolve(jsonRpcMessage.result);
                    } catch (e) {
                        if (e instanceof SolanaMobileWalletAdapterProtocolError) {
                            const responsePromise = jsonRpcResponsePromises[e.jsonRpcMessageId];
                            delete jsonRpcResponsePromises[e.jsonRpcMessageId];
                            responsePromise.reject(e);
                        } else {
                            throw e;
                        }
                    }
                    break;
                case 'hello_req_sent': {
                    const sharedSecret = await parseHelloRsp(
                        responseBuffer,
                        state.associationPublicKey,
                        state.ecdhPrivateKey,
                    );
                    state = { __type: 'connected', sharedSecret };
                    const wallet = new Proxy<MobileWallet>({} as MobileWallet, {
                        get<TMethodName extends keyof MobileWallet>(target: MobileWallet, p: TMethodName) {
                            if (target[p] == null) {
                                const method = p
                                    .toString()
                                    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                                    .toLowerCase();
                                target[p] = async function (params: Parameters<MobileWallet[TMethodName]>[0]) {
                                    const id = nextJsonRpcMessageId++;
                                    socket.send(
                                        await encryptJsonRpcMessage(
                                            {
                                                id,
                                                jsonrpc: '2.0',
                                                method,
                                                params,
                                            },
                                            sharedSecret,
                                        ),
                                    );
                                    return new Promise((resolve, reject) => {
                                        jsonRpcResponsePromises[id] = { resolve, reject };
                                    });
                                } as MobileWallet[TMethodName];
                            }
                            return target[p];
                        },
                        defineProperty() {
                            return false;
                        },
                        deleteProperty() {
                            return false;
                        },
                    });
                    try {
                        resolve(await callback(wallet));
                    } catch (e) {
                        reject(e);
                    } finally {
                        disposeSocket();
                        socket.close();
                    }
                    break;
                }
            }
        };
        let disposeSocket: () => void;
        let retryWaitTimeoutId: number;
        const attemptSocketConnection = () => {
            if (disposeSocket) {
                disposeSocket();
            }
            state = { __type: 'connecting', associationKeypair };
            socket = new WebSocket(websocketURL, [WEBSOCKET_PROTOCOL]);
            socket.addEventListener('open', handleOpen);
            socket.addEventListener('close', handleClose);
            socket.addEventListener('error', handleError);
            socket.addEventListener('message', handleMessage);
            disposeSocket = () => {
                window.clearTimeout(retryWaitTimeoutId);
                socket.removeEventListener('open', handleOpen);
                socket.removeEventListener('close', handleClose);
                socket.removeEventListener('error', handleError);
                socket.removeEventListener('message', handleMessage);
            };
        };
        attemptSocketConnection();
    });
}
