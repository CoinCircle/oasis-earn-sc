import { loadContractNames } from '@deploy-configurations/constants'
import { Network } from '@deploy-configurations/types/network'

const SERVICE_REGISTRY_NAMES = loadContractNames(Network.MAINNET)
// use this when forking mainnet to local
const HH_WALLET_ADDR = '0xc422ddf89ed0a5b38ec79db2e77c7076dc730b02';
// use this when deploying to mainnnet for real
const COINCIRCLE_METAMASK_ADDR = '0xd3D1F61C5E9ae7Cb7DD88012f4E08a3a6EC21a62'
const OWNER_ADDR = HH_WALLET_ADDR

export const config = {
  mpa: {
    core: {
      Swap: {
        name: 'Swap',
        deploy: true,
        address: '',
        serviceRegistryName: SERVICE_REGISTRY_NAMES.common.SWAP,
        history: [],
        constructorArgs: [
          // authorized address
          COINCIRCLE_METAMASK_ADDR,
          // fee recipient
          '0x588802daA6a39932a51275cEA78f2aE239ea80B5',
          // default fee (base 10000)
          20,
          'address:ServiceRegistry',
        ],
      },
    },
    actions: {},
  },
}
