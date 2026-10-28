import api from "./api.js";
import { handle_admin_request } from "./admin.js";
import { handle_discovery_request } from "./discover.js";
import { handle_rank_request, enqueue_rank_snapshot } from "./rank.js";
import { create_worker } from "./router.js";

export { APIDurableObject } from "./server/durable_object.js";
export default create_worker({
  api,
  admin: handle_admin_request,
  discovery: handle_discovery_request,
  rank: handle_rank_request,
  rank_snapshot: enqueue_rank_snapshot,
});
