// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

import { RelayProvider } from '../src/relayclient/RelayProvider'
import { Address, AsyncDataCallback } from '../src/relayclient/types/Aliases'
import {
  RelayHubInstance, StakeManagerInstance,
  TestVerifierEverythingAcceptedInstance, TestVerifierPreconfiguredApprovalInstance,
  TestRecipientInstance,
  SmartWalletInstance,
  ProxyFactoryInstance,
  TestDeployVerifierEverythingAcceptedInstance
} from '../types/truffle-contracts'
import { deployHub, startRelay, stopRelay, getTestingEnvironment, createProxyFactory, createSmartWallet, getExistingGaslessAccount } from './TestUtils'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { EnvelopingConfig } from '../src/relayclient/Configurator'
import { toBuffer } from 'ethereumjs-util'
import { AccountKeypair } from '../src/relayclient/AccountManager'

const TestRecipient = artifacts.require('tests/TestRecipient')
const TestVerifierEverythingAccepted = artifacts.require('tests/TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('tests/TestDeployVerifierEverythingAccepted')
const TestVerifierPreconfiguredApproval = artifacts.require('tests/TestVerifierPreconfiguredApproval')

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const SmartWallet = artifacts.require('SmartWallet')

const options = [
  {
    title: 'Direct-',
    relay: false
  },
  {
    title: 'Relayed-',
    relay: true
  }
]

options.forEach(params => {
  contract(params.title + 'Flow', function (accounts) {
    let from: Address
    let sr: TestRecipientInstance
    let verifier: TestVerifierEverythingAcceptedInstance
    let deployVerifier: TestDeployVerifierEverythingAcceptedInstance
    let rhub: RelayHubInstance
    let sm: StakeManagerInstance
    let relayproc: ChildProcessWithoutNullStreams
    let relayClientConfig: Partial<EnvelopingConfig>
    let fundedAccount: AccountKeypair
    let gaslessAccount: AccountKeypair
    let approvalVerifier: TestVerifierPreconfiguredApprovalInstance

    before(async () => {
      const gasPriceFactor = 1.2

      approvalVerifier = await TestVerifierPreconfiguredApproval.new()

      // An accound already funded on RSK
      fundedAccount = {
        privateKey: toBuffer('0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4'),
        address: '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
      }

      // An account from RSK that has been depleted to ensure it has no funds
      gaslessAccount = await getExistingGaslessAccount()

      sm = await StakeManager.new(0)
      const p = await Penalizer.new()
      verifier = await TestVerifierEverythingAccepted.new()
      deployVerifier = await TestDeployVerifierEverythingAccepted.new()

      rhub = await deployHub(sm.address, p.address)
      if (params.relay) {
        process.env.relaylog = 'true'

        relayproc = await startRelay(rhub.address, sm, {
          workerTargetBalance: 0.6e18,
          stake: 1e18,
          delay: 3600 * 24 * 7,
          pctRelayFee: 12,
          url: 'asd',
          relayOwner: fundedAccount.address,
          // @ts-ignore
          rskNodeUrl: web3.currentProvider.host,
          gasPriceFactor,
          relaylog: process.env.relaylog,
          relayVerifierAddress: verifier.address,
          deployVerifierAddress: deployVerifier.address,
          trustedVerifiers: JSON.stringify([approvalVerifier.address]) // extra verifiers to trust
        })
        console.log('relay started')
        from = gaslessAccount.address
      } else {
        from = fundedAccount.address
      }
      sr = await TestRecipient.new()
    })

    after(async function () {
      await stopRelay(relayproc)
    })

    if (params.relay) {
      before(params.title + 'enable relay', async function () {
        const env = await getTestingEnvironment()
        const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
        const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
        const smartWalletInstance: SmartWalletInstance = await createSmartWallet(accounts[0], gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)
        relayClientConfig = {
          logLevel: 5,
          relayHubAddress: rhub.address,
          relayVerifierAddress: verifier.address,
          deployVerifierAddress: deployVerifier.address,
          chainId: env.chainId,
          forwarderAddress: smartWalletInstance.address
        }

        // @ts-ignore
        const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig)
        relayProvider.addAccount(gaslessAccount)

        // web3.setProvider(relayProvider)

        // NOTE: in real application its enough to set the provider in web3.
        // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
        // so changing the global one is not enough...
        TestRecipient.web3.setProvider(relayProvider)
      })
    }

    it(params.title + 'send normal transaction', async () => {
      console.log('running emitMessage (should succeed)')
      let res
      try {
        const gas = await sr.contract.methods.emitMessage('hello').estimateGas()
        res = await sr.emitMessage('hello', { from: from, gas })
      } catch (e) {
        console.log('error is ', e.message)
        throw e
      }
      assert.equal('hello', res.logs[0].args.message)
    })

    it(params.title + 'send gasless transaction', async () => {
      console.log('gasless=' + gaslessAccount.address)

      console.log('running gasless-emitMessage (should fail for direct, succeed for relayed)')
      let ex: Error | undefined
      try {
        const res = await sr.emitMessage('hello, from gasless', { from: gaslessAccount.address, gas: 1e6 })
        console.log('res after gasless emit:', res.logs[0].args.message)
      } catch (e) {
        ex = e
      }

      if (params.relay) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        assert.ok(ex == null, `should succeed sending gasless transaction through relay. got: ${ex?.toString()}`)
      } else {
        // In RSK if the account doesn't have funds the error message received is 'the sender account doesn't exist'
        // eslint-disable-next-line @typescript-eslint/no-base-to-string,@typescript-eslint/restrict-template-expressions
        assert.ok(ex!.toString().indexOf('insufficient funds') > 0, `Expected Error with 'insufficient funds'. got: ${ex?.toString()}`)
      }
    })

    it(params.title + 'running testRevert (should always fail)', async () => {
      await asyncShouldThrow(async () => {
        await sr.testRevert({ from: from })
      }, 'revert')
    })

    if (params.relay) {
      let relayProvider: RelayProvider

      describe('request with approvaldata', () => {
        const setRecipientProvider = function (asyncApprovalData: AsyncDataCallback): void {
          // @ts-ignore
          relayProvider = new RelayProvider(web3.currentProvider, Object.assign(relayClientConfig, {
            relayVerifierAddress: approvalVerifier.address,
            deployVerifierAddress: deployVerifier.address
          }), { asyncApprovalData })

          TestRecipient.web3.setProvider(relayProvider)
          TestVerifierPreconfiguredApproval.web3.setProvider(relayProvider)
          TestVerifierEverythingAccepted.web3.setProvider(relayProvider)

          relayProvider.addAccount(gaslessAccount)
        }

        it(params.title + 'wait for specific approvalData', async () => {
          try {
            setRecipientProvider(async () => await Promise.resolve('0x414243'))

            await approvalVerifier.setExpectedApprovalData('0x414243', {
              from: fundedAccount.address,
              useEnveloping: false
            })

            await sr.emitMessage('xxx', {
              from: gaslessAccount.address,
              callVerifier: approvalVerifier.address
            })
          } catch (e) {
            console.log('error1: ', e)
            throw e
          } finally {
            await approvalVerifier.setExpectedApprovalData('0x', {
              from: fundedAccount.address,
              useEnveloping: false
            })
          }
        })

        it(params.title + 'fail if asyncApprovalData throws', async () => {
          setRecipientProvider(() => { throw new Error('approval-exception') })
          await asyncShouldThrow(async () => {
            await sr.emitMessage('xxx', {
              from: gaslessAccount.address,
              callVerifier: approvalVerifier.address
            })
          }, 'approval-exception')
        })

        it(params.title + 'fail on no approval data', async () => {
          try {
            // @ts-ignore
            await approvalVerifier.setExpectedApprovalData(Buffer.from('hello1'), {
              from: fundedAccount.address,
              useEnveloping: false
            })
            await asyncShouldThrow(async () => {
              setRecipientProvider(async () => await Promise.resolve('0x'))

              await sr.emitMessage('xxx', {
                from: gaslessAccount.address,
                callVerifier: approvalVerifier.address
              })
            }, 'verifier rejected in local view call to \'relayCall()\'')
          } catch (e) {
            console.log('error3: ', e)
            throw e
          } finally {
            // @ts-ignore
            await approvalVerifier.setExpectedApprovalData(Buffer.from(''), {
              from: fundedAccount.address,
              useEnveloping: false
            })
          }
        })
      })
    }

    async function asyncShouldThrow (asyncFunc: () => Promise<any>, str?: string): Promise<void> {
      const msg = str ?? 'Error'
      let ex: Error | undefined
      try {
        await asyncFunc()
      } catch (e) {
        ex = e
      }
      assert.ok(ex != null, `Expected to throw ${msg} but threw nothing`)
      const isExpectedError = ex?.toString().includes(msg)
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      assert.ok(isExpectedError, `Expected to throw ${msg} but threw ${ex?.message}`)
    }
  })
})
