import { requireEnv } from "../helpers/env";

export const TEST_USER = {
  id: Number(requireEnv("E2E_TEST_USER_TG_ID")),
  first_name: "E2E",
  last_name: "User"
};

export const TEST_ADMIN = {
  id: Number(requireEnv("E2E_TEST_ADMIN_TG_ID")),
  first_name: "E2E",
  last_name: "Admin"
};
