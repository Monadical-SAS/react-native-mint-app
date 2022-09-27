import * as anchor from '@project-serum/anchor';
import {useConnection} from '@solana/wallet-adapter-react';
import {
  PublicKey,
  RpcResponseAndContext,
  SignatureResult,
  Transaction,
} from '@solana/web3.js';
import {transact} from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import React, {useContext, useState} from 'react';
import {Linking, StyleSheet, View} from 'react-native';
import {Button} from 'react-native-paper';

import useAuthorization from '../utils/useAuthorization';
import useGuardedCallback from '../utils/useGuardedCallback';
import {getCandyMachineState, mintOneToken} from '../utils/candy-machine';
import {SnackbarContext} from './SnackbarProvider';
import {Base64EncodedAddress} from '@solana-mobile/mobile-wallet-adapter-protocol';

const candyMachineId = new PublicKey(
  '4muNoMvUbLFi8btqE8QV2YnsFYF2qUQ6tb9xVyHSUPFj',
);

export default function MintButton() {
  const {authorizeSession, selectedAccount} = useAuthorization();
  const {connection} = useConnection();
  const setSnackbarProps = useContext(SnackbarContext);

  const [loading, setLoading] = useState(false);

  const mintNewToken = useGuardedCallback(async (): Promise<
    [string, RpcResponseAndContext<SignatureResult>]
  > => {
    const [signature] = await transact(async wallet => {
      const [freshAccount, latestBlockhash] = await Promise.all([
        authorizeSession(wallet),
        connection.getLatestBlockhash(),
      ]);

      const accountPublicKey = freshAccount.publicKey;
      const anchorWallet = {publicKey: accountPublicKey} as anchor.Wallet;

      const candyMachine = await getCandyMachineState(
        anchorWallet,
        candyMachineId,
        connection,
      );

      const [instructions, signers] = await mintOneToken(
        candyMachine,
        accountPublicKey,
      );

      const transaction = new Transaction();
      instructions.forEach(instruction => transaction.add(instruction));
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = accountPublicKey;
      transaction.partialSign(...signers);

      return await wallet.signAndSendTransactions({
        transactions: [transaction],
      });
    });

    return [signature, await connection.confirmTransaction(signature)];
  }, [authorizeSession, connection]);

  const getMintFromSignature = useGuardedCallback(
    async (
      signature: Base64EncodedAddress,
    ): Promise<Base64EncodedAddress | null> => {
      const tx = await connection.getTransaction(signature);
      const postTokenBalances = tx?.meta?.postTokenBalances;
      if (!postTokenBalances || postTokenBalances.length !== 1) return null;
      return postTokenBalances[0].mint;
    },
  );

  const handleClickMintButton = async () => {
    setLoading(true);

    try {
      const result = await mintNewToken();
      if (!result) {
        showAlertError('Error minting the token');
        return;
      }

      const [signature, {value: err}] = result;
      if (err) {
        showAlertError(err);
        return;
      }

      const mint = await getMintFromSignature(signature);
      if (mint) {
        const mintUrl = `https://www.solaneyes.com/address/${mint}`;
        await showSuccessAlert(' View NFT', mintUrl);
        return;
      }

      if (signature) {
        const signatureUrl = `https://explorer.solana.com/tx/${signature}`;
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
