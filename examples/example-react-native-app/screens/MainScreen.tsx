import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Appbar, Divider, Portal, Text } from 'react-native-paper';

import AccountInfo from '../components/AccountInfo';
import useAuthorization from '../utils/useAuthorization';
import MintButton from '../components/MintButton';

export default function MainScreen() {
  const { accounts, onChangeAccount, selectedAccount } = useAuthorization();

  return (
    <>
      <Appbar.Header elevated mode="center-aligned">
        <Appbar.Content title="React Native dApp" />
      </Appbar.Header>
      <Portal.Host>
        <ScrollView contentContainerStyle={styles.container}>
          <Text variant="bodyLarge">
            My awesome Candy Machine
          </Text>
          <Divider style={styles.spacer} />

          <MintButton>
            Mint NFT
          </MintButton>
        </ScrollView>
        {accounts && selectedAccount ? (
          <AccountInfo
            accounts={accounts}
            onChange={onChangeAccount}
            selectedAccount={selectedAccount}
          />
        ) : null}
      </Portal.Host>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  shell: {
    height: '100%',
  },
  spacer: {
    marginVertical: 16,
    width: '100%',
  },
  textInput: {
    width: '100%',
  },
});
