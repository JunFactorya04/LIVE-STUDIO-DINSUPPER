import { createAiClient } from "../ai/client";
import { createBizClient } from "../biz/client";
import { createShipClient } from "../ship/client";
import { createWarehouseClient } from "../warehouse/client";
import { Team } from "./team";

let shared: Team | undefined;

/** One team for the whole app: the Nhân viên AI page and the chat bridge share it. */
export function getTeam(): Team {
  return (shared ??= new Team({
    ai: createAiClient(),
    ship: createShipClient(),
    warehouse: createWarehouseClient(),
    biz: createBizClient(),
    catalog: () => [],
    lang: () => "vi",
  }));
}
