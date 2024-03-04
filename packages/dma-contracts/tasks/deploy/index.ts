import { Network } from '@deploy-configurations/types/network'
import { getForkedNetwork as getUnderlyingNetwork } from '@deploy-configurations/utils/network'
import { DeploymentSystem } from '@dma-contracts/scripts/deployment/deploy'
import { task } from 'hardhat/config'

task('deploy', 'Deploy the system to a local node.').setAction(
  async (taskArgs: { configExtensionPath: string }, hre) => {
    console.log(`
    ===========
    deploying
    ===========
    `)
    const ds = new DeploymentSystem(hre)
    await ds.init()
    const network = await getUnderlyingNetwork(hre.ethers.provider)

    /**
     * We're using test-config files for now because they
     * redeploy the service registry allowing for a full system deployment
     */
    const configByNetwork = {
      [Network.MAINNET]: './test/mainnet.conf.ts',
      [Network.OPTIMISM]: './test/optimism.conf.ts',
    }
    if (network === Network.GOERLI) throw new Error('Goerli is not supported yet')
    const configPath = configByNetwork[network]
    await ds.loadConfig(configPath)

    const swapConfigPath = './test/swap.conf.ts'
    await ds.extendConfig(swapConfigPath)

    console.log('===== DEPLOY ALL ======')
    await ds.deployAll()
    // console.log('instantiating....')
    // await ds.instantiate()
    console.log('===== ADD ALL ENTRIES ======')
    await ds.addAllEntries().catch(e => {
      console.error('failed addAllEntries', e)
    })
    console.log('===== ADD OPERATION ENTRIES ======')
    await ds.addOperationEntries().catch(e => {
      console.error('failed addOperationEntries', e)
    })
    await ds.saveConfig()
    const dsSystem = ds.getSystem()
    const { system } = dsSystem
    const swapContract = system.uSwap ? system.uSwap.contract : system.Swap.contract
    await swapContract.addFeeTier(0).catch(e => {
      console.error('failed addFeeTier', e)
    })
    await swapContract.addFeeTier(7).catch(e => {
      console.error('failed addFeeTier', e)
    })
    await system.AccountGuard.contract
      .setWhitelist(system.OperationExecutor.contract.address, true)
      .catch(e => {
        console.error('failed setWhitelist', e)
      })
    await ds.verifyAllContracts()
  },
)
