import * as anchor from '@project-serum/anchor';
import {useConnection} from '@solana/wallet-adapter-react';
import {PublicKey, Transaction} from '@solana/web3.js';
import {transact} from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import React, {useContext, useState} from 'react';
import {Linking, StyleSheet, View} from 'react-native';
import {Button} from 'react-native-paper';

import useAuthorization from '../utils/useAuthorization';
import useGuardedCallback from '../utils/useGuardedCallback';
import {getCandyMachineState, mintOneToken} from '../utils/candy-machine';
import {SnackbarContext} from './SnackbarProvider';

const EXPLORER_URL = 'https://explorer.solana.com';
const CLUSTER = '?cluster=devnet';
const CANDY_MACHINE_ID = new PublicKey(
  '8NfYGcW3auAdBvddvaGWGmUHb5eoATFfRtGkqG1us3zJ',
);

export default function MintButton() {
  const {authorizeSession, selectedAccount} = useAuthorization();
  const {connection} = useConnection();
  const setSnackbarProps = useContext(SnackbarContext);

  const [loading, setLoading] = useState(false);
  const [explorerURL, setExplorerURL] = useState('');

  const mintNewToken = useGuardedCallback(async (): Promise<any> => {
    const [signature, mint] = await transact(async wallet => {
      const freshAccount = await authorizeSession(wallet);
      const latestBlockhash = await connection.getLatestBlockhash();

      const candyMachine = await getCandyMachineState(
        {publicKey: freshAccount.publicKey} as anchor.Wallet,
        CANDY_MACHINE_ID,
        connection,
      );

      const [instructions, signers, mintPublicKey] = await mintOneToken(
        candyMachine,
        freshAccount.publicKey,
      );

      const transaction = new Transaction();
      instructions.forEach(instruction => transaction.add(instruction));
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = freshAccount.publicKey;
      transaction.partialSign(...signers);

      const signatureResponse = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });

      return [signatureResponse[0], mintPublicKey];
    });

    await connection.confirmTransaction(signature);

    return {signature, mint};
  }, [authorizeSession, connection]);

  const handleClickMintButton = async () => {
    try {
      setLoading(true);
      const result = await mintNewToken();
      setLoading(false);

      if (!result && !(result.signature || result.mint)) {
        showAlert('Error minting the token');
        return;
      }

      if (result.mint) {
        const url = `${EXPLORER_URL}/address/${result.mint}${CLUSTER}`;
        setExplorerURL(url);
        showAlert('NFT minted successfully');
        return;
      }

      if (result.signature) {
        const url = `${EXPLORER_URL}/tx/${result.signature}${CLUSTER}`;
        setExplorerURL(url);
        showAlert('Signature generated successfully');
        return;
      }

      showAlert('Error minting the new NFT');
    } catch (error) {
      console.log(error);
    }
  };

  const showAlert = (message: string) => {
    setSnackbarProps({
      children: message,
    });
  };

  const openLink = async (url: string) => {
    await Linking.openURL(url);
  };

  return (
    <View style={styles.buttonGroup}>
      <Button
        disabled={loading || !selectedAccount}
        loading={loading}
        onPress={handleClickMintButton}
        mode="contained"
        style={styles.actionButton}>
        Mint NFT
      </Button>

      {explorerURL && (
        <Button
          onPress={() => openLink(explorerURL)}
          mode="contained"
          style={styles.actionButton}>
          View Details
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  buttonGroup: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  actionButton: {
    flex: 1,
    marginBottom: 24,
  },
});
