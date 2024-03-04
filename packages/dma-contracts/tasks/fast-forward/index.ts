import { ADDRESSES } from '@deploy-configurations/addresses'
import { Network } from '@deploy-configurations/types/network'
import { getAddressesFor } from '@dma-common/utils/common'
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { task } from 'hardhat/config'

task('fast-forward', 'Fast Forward')
.addOptionalParam('numblocks', 'Number of blocks to fast forward')
.setAction(async (taskArgs, hre) => {
  const { name: network } = hre.network
  const numBlocks = taskArgs.numblocks || 4 * 60 * 24 * 180;
  console.log(`fast forwarding ${numBlocks} blocks on ${network}`)
  const before = await hre.ethers.provider.getBlockNumber();
  console.log(`before: ${before}`)
  // fast forward by numBlocks
  await mine(Number(numBlocks))
  const after = await hre.ethers.provider.getBlockNumber();
  console.log(`after: ${after}`)
})
