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

const candyMachineId = new PublicKey(
  '8NfYGcW3auAdBvddvaGWGmUHb5eoATFfRtGkqG1us3zJ',
);

export default function MintButton() {
  const {authorizeSession, selectedAccount} = useAuthorization();
  const {connection} = useConnection();
  const setSnackbarProps = useContext(SnackbarContext);

  const [loading, setLoading] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState('');
  const [mintUrl, setMintUrl] = useState('');

  const mintNewToken = useGuardedCallback(async (): Promise<any> => {
    const [signature, mint] = await transact(async wallet => {
      const freshAccount = await authorizeSession(wallet);
      const latestBlockhash = await connection.getLatestBlockhash();

      const candyMachine = await getCandyMachineState(
        {publicKey: freshAccount.publicKey} as anchor.Wallet,
        candyMachineId,
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
      console.log(result);
      setLoading(false);

      if (!result && !(result.signature || result.mint)) {
        showAlertError('Error minting the token');
        return;
      }

      if (result.mint) {
        const url = `https://explorer.solana.com/address/${result.mint}?cluster=devnet`;
        setMintUrl(url);
        await showSuccessAlert(' View NFT', url);
        return;
      }

      if (result.signature) {
        const url = `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`;
        setSignatureUrl(url);
        await showSuccessAlert(' View transaction', url);
        return;
      }

      showAlertError('Error minting the new NFT');
    } catch (error) {
      console.log(error);
    }

    setLoading(false);
  };

  const showSuccessAlert = async (title: string, url: string) => {
    setSnackbarProps({
      action: {
        label: title,
        async onPress() {
          await openLink(url);
        },
      },
      children: 'NFT minted',
    });
  };

  const showAlertError = (error: any) => {
    const errorMessage = error instanceof Error ? error.message : error;
    setSnackbarProps({
      children: `Failed to mint: ${errorMessage}`,
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

      {signatureUrl && (
        <Button
          onPress={() => openLink(signatureUrl)}
          mode="contained"
          style={styles.actionButton}>
          View Signature
        </Button>
      )}

      {mintUrl && (
        <Button
          onPress={() => openLink(mintUrl)}
          mode="contained"
          style={styles.actionButton}>
          View NFT
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
