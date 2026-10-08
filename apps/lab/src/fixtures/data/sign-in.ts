import type { DataMode, SignInData } from "../types.ts";
import { memoize } from "./memoize.ts";
import { people, repository } from "./people.ts";

export type SignInScenario = "guest" | "signing-in" | "forbidden" | "error";

const forbiddenMessage =
  "Your repository access changed. Write access to this repository is required.";

function build(scenario: string, mode: DataMode): SignInData {
  // A request without access returns no data today: no repository name and no
  // identity. Both exist in `improved` mode only.
  const known = mode === "improved" ? { repository } : {};
  if (scenario === "signing-in") return { status: "signing-in", ...known };
  if (scenario === "forbidden") {
    return {
      status: "forbidden",
      message: forbiddenMessage,
      // A contributor without write access to the repository.
      ...(mode === "improved" ? { user: people.amara } : {}),
      ...known,
    };
  }
  if (scenario === "error") {
    return {
      status: "error",
      message: "The service is temporarily unavailable. Please retry.",
      reference: "req_01JZ8Q2N5K",
    };
  }
  return { status: "guest", ...known };
}

const cached = memoize(build);

/**
 * Returns the sign-in and access data of a scenario in one data mode. An
 * unknown scenario gives the guest state. The same arguments return the same
 * object. In a component, call `useSignInData(scenario)`: it follows the Data
 * control.
 */
export function getSignInData(
  scenario: SignInScenario | (string & {}),
  mode: DataMode,
): SignInData {
  return cached(scenario, mode);
}
