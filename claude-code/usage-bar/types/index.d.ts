/** One plan limit window, as the last API response reported it. */
export type UsageWindow = {
  /** The engine's name for the window: `five_hour`, `seven_day`, `spend_limit`. */
  kind: string
  /** 0 to 100, past 100 on an exceeded spend limit. */
  percentUsed: number
  /** ISO 8601 timestamp of the reset, when known. */
  resetsAt?: string
}

/** The weekly limit scoped to one model (Fable), as the /usage endpoint reports it. */
export type ModelWeek = {
  /** The model's display name, as /usage titles it: `Fable`. */
  name: string
  /** 0 to 100. */
  percentUsed: number
  /** ISO 8601 timestamp of the reset, when the endpoint gives one. */
  resetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    /**
     * `model`: the main loop's model as `/model` shows it; "" until first read.
     * `effort`: the effort level the main loop's last request asked for, the one `/effort` last
     * set, or the `effortLevel` setting before either; "" when unknown or the model takes none.
     * `fable`: the Fable weekly limit, null until read or when the plan has none.
     */
    'usage-bar': {
      isOn: boolean
      windows: UsageWindow[]
      model: string
      effort: string
      fable: ModelWeek | null
    }
  }
}
