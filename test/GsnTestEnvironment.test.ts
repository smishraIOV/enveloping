import { GsnTestEnvironment, TestEnvironment } from '../src/relayclient/GsnTestEnvironment'
import { HttpProvider } from 'web3-core'
import { expectEvent } from '@openzeppelin/test-helpers'
import { TestRecipientInstance, ProxyFactoryInstance } from '../types/truffle-contracts'
import { getTestingEnvironment, getGaslessAccount } from './TestUtils'
import { constants } from '../src/common/Constants'
import { toHex } from 'web3-utils'

const TestRecipient = artifacts.require('TestRecipient')
const TestTokenRecipient = artifacts.require('TestTokenRecipient')
const ProxyFactory = artifacts.require('ProxyFactory')
const DeployVerifier = artifacts.require('DeployVerifier')
const RelayVerifier = artifacts.require('RelayVerifier')

contract('GsnTestEnvironment', function (accounts) {
  describe('#startGsn()', function () {
    it('should create a valid test environment for other tests to rely on', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const testEnv = await GsnTestEnvironment.startGsn(host, await getTestingEnvironment())
      assert.equal(testEnv.deploymentResult.relayHubAddress.length, 42)
    })

    after(async function () {
      await GsnTestEnvironment.stopGsn()
    })
  })

  describe('using RelayClient', () => {
    let testEnvironment: TestEnvironment

    before(async () => {
      const host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
      testEnvironment = await GsnTestEnvironment.startGsn(host, await getTestingEnvironment())
      const dVerifier = await DeployVerifier.at(testEnvironment.deploymentResult.deployVerifierAddress)
      await dVerifier.acceptToken(constants.ZERO_ADDRESS, { from: accounts[0] })
      const rVerifier = await RelayVerifier.at(testEnvironment.deploymentResult.relayVerifierAddress)
      await rVerifier.acceptToken(constants.ZERO_ADDRESS, { from: accounts[0] })
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should relay using relayTransaction', async () => {
      const sender = await getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      const sr: TestRecipientInstance = await TestRecipient.new()

      testEnvironment.relayProvider.relayClient.accountManager.addAccount(sender)

      await testEnvironment.relayProvider.deploySmartWallet({
        from: sender.address,
        to: constants.ZERO_ADDRESS,
        value: '0',
        gas: toHex('400000'),
        data: '0x',
        tokenContract: constants.ZERO_ADDRESS,
        tokenAmount: '0',
        recoverer: constants.ZERO_ADDRESS,
        index: '0',
        callForwarder: testEnvironment.deploymentResult.factoryAddress,
        callVerifier: testEnvironment.deploymentResult.deployVerifierAddress,
        clientId: '1'
      })

      const wallet = await proxyFactory.getSmartWalletAddress(sender.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.SHA3_NULL_S, '0')
      const ret = await testEnvironment.relayProvider.relayClient.relayTransaction({
        from: sender.address,
        to: sr.address,
        callForwarder: wallet,
        callVerifier: testEnvironment.deploymentResult.relayVerifierAddress,
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI(),
        tokenAmount: '0x00',
        tokenContract: constants.ZERO_ADDRESS,
        isSmartWalletDeploy: false,
        clientId: '1',
        relayHub: testEnvironment.deploymentResult.relayHubAddress
      })

      assert.deepEqual([...ret.relayingErrors.values(), ...ret.pingErrors.values()], [])
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.msgSender.toLowerCase(), wallet.toLowerCase())
    })

    it('should relay using relayTransaction invoking an ERC20 contract', async () => {
      const tokenReceiverAddress = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
      const sender = await getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      const str: TestTokenRecipientInstance = await TestTokenRecipient.new()

      const wallet = await createSmartWallet(sender.address, proxyFactory, sender.privateKey, (await getTestingEnvironment()).chainId)
      const initialSenderBalance = 200
      await str.mint(initialSenderBalance, wallet.address)
      testEnvironment.relayProvider.relayClient.accountManager.addAccount(sender)

      const ret = await testEnvironment.relayProvider.relayClient.relayTransaction({
        from: sender.address,
        to: str.address,
        forwarder: wallet.address,
        paymaster: testEnvironment.deploymentResult.naivePaymasterAddress,
        paymasterData: '0x',
        gas: '0x' + 1e6.toString(16),
        data: str.contract.methods.transfer(tokenReceiverAddress, '5').encodeABI(),
        tokenRecipient: constants.ZERO_ADDRESS,
        tokenAmount: '0x00',
        tokenContract: constants.ZERO_ADDRESS,
        factory: constants.ZERO_ADDRESS,
        clientId: '1'
      })

      assert.deepEqual([...ret.relayingErrors.values(), ...ret.pingErrors.values()], [])
      const events = await str.contract.getPastEvents()
      assert.equal(events[0].event, 'Transfer')
      const balance = await str.balanceOf(tokenReceiverAddress)
      const valueToSend = 5
      assert.equal(balance.toString(), valueToSend.toString())
      const lastSenderBalance = await str.balanceOf(wallet.address)
      assert.equal(lastSenderBalance.add(new BN(valueToSend)).toString(), initialSenderBalance.toString())
    })
  })

  describe('using RelayProvider', () => {
    let testEnvironment: TestEnvironment

    before(async function () {
      const host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
      testEnvironment = await GsnTestEnvironment.startGsn(host, await getTestingEnvironment())
      const dVerifier = await DeployVerifier.at(testEnvironment.deploymentResult.deployVerifierAddress)
      await dVerifier.acceptToken(constants.ZERO_ADDRESS, { from: accounts[0] })
      const rVerifier = await RelayVerifier.at(testEnvironment.deploymentResult.relayVerifierAddress)
      await rVerifier.acceptToken(constants.ZERO_ADDRESS, { from: accounts[0] })
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should send relayed transaction through RelayProvider', async () => {
      const sender = await getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      testEnvironment.relayProvider.addAccount(sender)

      const sr: TestRecipientInstance = await TestRecipient.new()
      await testEnvironment.relayProvider.deploySmartWallet({
        from: sender.address,
        to: constants.ZERO_ADDRESS,
        value: '0',
        gas: toHex('400000'),
        data: '0x',
        tokenContract: constants.ZERO_ADDRESS,
        tokenAmount: '0',
        recoverer: constants.ZERO_ADDRESS,
        index: '0',
        callForwarder: proxyFactory.address,
        callVerifier: testEnvironment.deploymentResult.deployVerifierAddress,
        clientId: '1'
      })

      const wallet = await proxyFactory.getSmartWalletAddress(sender.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.SHA3_NULL_S, '0')

      // @ts-ignore
      TestRecipient.web3.setProvider(testEnvironment.relayProvider)

      const txDetails = {
        from: sender.address,
        callVerifier: testEnvironment.deploymentResult.relayVerifierAddress,
        callForwarder: wallet
      }
      const ret = await sr.emitMessage('hello', txDetails)
      expectEvent(ret, 'SampleRecipientEmitted', { msgSender: wallet })
    })

    it('should send relayed transaction invoking an ERC20 contract through RelayProvider', async () => {
      const tokenReceiverAddress = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
      const sender = await getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      const str: TestTokenRecipientInstance = await TestTokenRecipient.new()

      const wallet = await createSmartWallet(sender.address, proxyFactory, sender.privateKey, (await getTestingEnvironment()).chainId)
      testEnvironment.relayProvider.addAccount(sender)
      const initialSenderBalance = 200
      await str.mint(initialSenderBalance, wallet.address)

      // @ts-ignore
      TestTokenRecipient.web3.setProvider(testEnvironment.relayProvider)

      const txDetails = {
        from: sender.address,
        paymaster: testEnvironment.deploymentResult.naivePaymasterAddress,
        forwarder: wallet.address
      }

      const valueToSend = 5
      const ret = await str.transfer(tokenReceiverAddress, valueToSend, txDetails)
      expectEvent(ret, 'Transfer')
      const balance = await str.balanceOf(tokenReceiverAddress)
      assert.equal(balance.toString(), '5')
      const lastSenderBalance = await str.balanceOf(wallet.address)
      assert.equal(lastSenderBalance.add(new BN(valueToSend)).toString(), initialSenderBalance.toString())
    })
  })
})
