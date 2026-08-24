import { requireEnv } from "../helpers/env";
import { E2E_PREFIX } from "../helpers/api";

export const TEST_USER = {
  id: Number(requireEnv("E2E_TEST_USER_TG_ID")),
  first_name: `${E2E_PREFIX} User`,
  last_name: "User"
};

export const TEST_ADMIN = {
  id: Number(requireEnv("E2E_TEST_ADMIN_TG_ID")),
  first_name: `${E2E_PREFIX} Admin`,
  last_name: "Admin"
};
