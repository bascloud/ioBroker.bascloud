// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
  namespace ioBroker {
    interface AdapterConfig {
      tenantId: string
      apiKey: string
      readingsWrite: {
        localId: string
        remoteId: string
        intervalEnabled: boolean
        interval: number
        intervalUnit: 'm' | 'h' | 'd'
        intervalFunction: 'last' | 'min' | 'max'
        alwaysSend: boolean
      }[]
      readingsRead: {
        localId: string
        remoteId: string
        unit: string
        interval: number
        intervalUnit: 'm' | 'h' | 'd'
      }[]
    }
  }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {}
