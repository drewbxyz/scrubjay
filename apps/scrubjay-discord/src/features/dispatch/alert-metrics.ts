/** Descriptor for the scrubjay.dispatch.alerts counter, created in both
 *  DispatchService and BootstrapService; the OTel SDK dedupes same-name
 *  instruments only when name + description + unit all match, so both sites
 *  MUST build from this one constant. */
export const ALERT_OUTCOMES_COUNTER = {
  description: "Alert delivery outcomes by status",
  name: "scrubjay.dispatch.alerts",
  unit: "{alert}",
} as const;
