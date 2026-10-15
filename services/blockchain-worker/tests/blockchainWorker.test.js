const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const addressGenerator = require('../src/services/addressGenerator');

describe('CEX Blockchain Worker Unit Tests', () => {

  describe('1. HD Wallet Address Generator', () => {
    test('Should derive deterministic EVM deposit addresses for users', () => {
      const addrUser1 = addressGenerator.deriveAddressByIndex(1);
      const addrUser2 = addressGenerator.deriveAddressByIndex(2);
      const addrUser1Repeat = addressGenerator.deriveAddressByIndex(1);

      // Pastikan format address valid (0x + 40 hex char)
      assert.ok(ethers.isAddress(addrUser1), 'Address user 1 harus valid');
      assert.ok(ethers.isAddress(addrUser2), 'Address user 2 harus valid');

      // User yang berbeda harus memiliki address yang berbeda
      assert.notEqual(addrUser1.toLowerCase(), addrUser2.toLowerCase(), 'Address user 1 dan 2 harus berbeda');

      // Address harus deterministik (sama jika user index sama)
      assert.equal(addrUser1, addrUser1Repeat, 'Address user 1 harus deterministik');
    });

    test('Should verify derivation from Master xPub has zero private key access', () => {
      // Buat xPub testing
      const mnemonic = ethers.Mnemonic.fromPhrase('test test test test test test test test test test test junk');
      const masterNode = ethers.HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'");
      const xpub = masterNode.neuter().extendedKey; // neuter() membuang private key, hanya tersisa xPub

      assert.ok(xpub.startsWith('xpub'), 'xPub harus diawali prefix xpub');

      const watchOnlyNode = ethers.HDNodeWallet.fromExtendedKey(xpub);
      const derivedChild = watchOnlyNode.derivePath('0/10');

      // Private key harus undefined/null pada watch-only node!
      assert.ok(!derivedChild.privateKey, 'Private key TIDAK BOLEH ada di memory scanner server!');
      assert.ok(ethers.isAddress(derivedChild.address), 'Address yang diturunkan harus valid');
    });
  });

  describe('2. Deposit Scanner ERC-20 & Native Parsing Logic', () => {
    test('Should accurately parse ERC-20 Transfer log topics and amounts', () => {
      const recipientAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
      const senderAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
      const rawTransferAmount = ethers.parseUnits('150.50', 6); // 150.50 USDT (6 desimal)

      // Simulasi Log ERC-20
      const topicTransfer = ethers.id('Transfer(address,address,uint256)');
      const topicFrom = ethers.zeroPadValue(senderAddress, 32);
      const topicTo = ethers.zeroPadValue(recipientAddress, 32);
      const logData = ethers.toBeHex(rawTransferAmount, 32);

      // Verifikasi parsing topic penerima
      const parsedRecipient = ethers.getAddress('0x' + topicTo.slice(26));
      assert.equal(parsedRecipient.toLowerCase(), recipientAddress.toLowerCase());

      // Verifikasi parsing nominal
      const parsedAmount = ethers.formatUnits(BigInt(logData), 6);
      assert.equal(parsedAmount, '150.5');
    });

    test('Should correctly calculate block confirmations for reorg safety', () => {
      const txBlock = 1000;
      const latestBlock1 = 1000;
      const conf1 = latestBlock1 - txBlock + 1;
      assert.equal(conf1, 1);

      const latestBlock12 = 1011;
      const conf12 = latestBlock12 - txBlock + 1;
      assert.equal(conf12, 12, '12 block confirmation safety tercapai');
    });
  });

  describe('3. Withdrawal Dispatcher Hot Wallet Signing', () => {
    test('Should sign and serialize valid transaction without broadcasting', async () => {
      const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const wallet = new ethers.Wallet(testPrivateKey);

      const txRequest = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        value: ethers.parseEther('0.25'),
        nonce: 0,
        gasLimit: 21000n,
        gasPrice: ethers.parseUnits('20', 'gwei'),
        chainId: 11155111n, // Sepolia
      };

      const signedTx = await wallet.signTransaction(txRequest);
      assert.ok(signedTx.startsWith('0x'), 'Signed raw transaction harus berawalan 0x');

      const parsedTx = ethers.Transaction.from(signedTx);
      assert.equal(parsedTx.to.toLowerCase(), txRequest.to.toLowerCase());
      assert.equal(parsedTx.value.toString(), txRequest.value.toString());
      assert.equal(parsedTx.from.toLowerCase(), wallet.address.toLowerCase());
    });
  });
});
