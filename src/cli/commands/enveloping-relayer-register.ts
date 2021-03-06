import { ether } from '@openzeppelin/test-helpers'
import CommandsLogic from '../CommandsLogic'
import { configure } from '../../relayclient/Configurator'
import { getNetworkUrl, getRelayHubAddress, envelopingCommander, getMnemonic } from '../utils'

const commander = envelopingCommander(['n', 'f', 'h', 'm'])
  .option('--relayUrl <url>', 'url to advertise the relayer (defaults to localhost:8090)')
  .option('--stake <stake>', 'amount to stake for the relayer, in wei (defaults to 0.01 RBTC)')
  .option(
    '--unstakeDelay <delay>',
    'blocks to wait between unregistering and withdrawing the stake (defaults to one 1000)'
  )
  .option(
    '--funds <funds>',
    'amount to transfer to the relayer to pay for relayed transactions, in wei (defaults to 0.02 RBTC)'
  )
  .parse(process.argv);

(async () => {
  const host = getNetworkUrl(commander.network)
  const hub = getRelayHubAddress(commander.hub)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(host, configure({ relayHubAddress: hub }), mnemonic)
  const registerOptions = {
    hub,
    from: commander.from ?? await logic.findWealthyAccount(),
    stake: commander.stake ?? ether('0.01'),
    funds: commander.funds ?? ether('0.02'),
    relayUrl: commander.relayUrl ?? 'http://localhost:8090',
    unstakeDelay: commander.unstakeDelay ?? 1000,
    gasPrice: commander.gasPrice ?? '1e9'
  }
  if (registerOptions.from == null) {
    console.error('Failed to find a wealthy "from" address')
    process.exit(1)
  }

  const result = await logic.registerRelay(registerOptions)
  if (result.success) {
    console.log('Relay registered successfully! Transactions:\n', result.transactions)
    process.exit(0)
  } else {
    console.error('Failed to register relay:', result.error)
    process.exit(1)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
