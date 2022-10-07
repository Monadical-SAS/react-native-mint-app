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
  '4sBYpJeQ8XEergKrivwJc4YejMXedEnugQddBzHktgy6',
);

export default function MintButton() {
  const {authorizeSession, selectedAccount} = useAuthorization();
  const {connection} = useConnection();
  const setSnackbarProps = useContext(SnackbarContext);

  const [loading, setLoading] = useState(false);

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

    return [signature, mint];
  }, [authorizeSession, connection]);

  const handleClickMintButton = async () => {
    try {
      setLoading(true);
      const result = await mintNewToken();
      setLoading(false);

      if (!result && !(result.signature || result.mint)) {
        showAlertError('Error minting the token');
        return;
      }

      const [signature, mint] = result;
      if (mint) {
        const mintUrl = `https://explorer.solana.com/address/${mint}?cluster=devnet`;
        await showSuccessAlert(' View NFT', mintUrl);
        return;
      }

      if (signature) {
        const signatureUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
        await showSuccessAlert(' View transaction', signatureUrl);
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
          await Linking.openURL(url);
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
    </View>
  );
}

const styles = StyleSheet.create({
  buttonGroup: {
    display: 'flex',
    flexDirection: 'row',
    width: '100%',
  },
  actionButton: {
    flex: 1,
    marginEnd: 8,
  },
});
