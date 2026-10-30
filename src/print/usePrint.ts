import { useSyncExternalStore } from "react";
import { getPrintService, type PrintService, type PrintStatus } from "./service";

export function usePrintStatus(service: PrintService = getPrintService()): PrintStatus {
  return useSyncExternalStore(service.subscribe, service.getSnapshot);
}
