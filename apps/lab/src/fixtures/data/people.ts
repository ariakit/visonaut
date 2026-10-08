import { element, rect, svgDocument, text, toDataUri } from "../images/svg.ts";
import { hash, hex } from "../random.ts";
import type { User } from "../types.ts";

/** A generated avatar: initials on a color that depends on the login. */
function avatar(login: string, name: string): string {
  const hue = hash(login) % 360;
  const initials = name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const body =
    rect({ x: 0, y: 0, width: 64, height: 64, fill: `hsl(${hue},46%,42%)` }) +
    element("circle", { cx: 64, cy: 0, r: 40, fill: "#ffffff", opacity: 0.12 }) +
    text({
      x: 32,
      y: 33,
      value: initials,
      fill: "#ffffff",
      size: 25,
      weight: 600,
      anchor: "middle",
    });
  return toDataUri(svgDocument(64, 64, body));
}

interface UserSeed {
  login: string;
  name: string;
  githubUserId: string;
  bot?: boolean;
}

function user({ login, name, githubUserId, bot }: UserSeed): User {
  return {
    id: hex(`user:${login}`, 32),
    githubUserId,
    login,
    name,
    avatarUrl: avatar(login, name),
    ...(bot ? { bot: true } : {}),
  };
}

/** The signed-in maintainer in every ready dataset. */
export const currentUser = user({ login: "diegohaz", name: "Haz", githubUserId: "3068563" });

export const people = {
  haz: currentUser,
  // The six reviewers from `sofia` to `lucas` are invented people, and on
  // 2026-10-07 the public GitHub API answered HTTP 404 for each login and each
  // user id below, so none of them was the account of a real person on that day.
  sofia: user({ login: "nilsson-sofia", name: "Sofia Nilsson", githubUserId: "48210378" }),
  kenji: user({ login: "morikenji", name: "Kenji Mori", githubUserId: "19044863" }),
  amara: user({ login: "okafor-amara", name: "Amara Okafor", githubUserId: "72915528" }),
  theo: user({ login: "brandt-theo", name: "Theo Brandt", githubUserId: "8830227" }),
  priya: user({ login: "raman-priya", name: "Priya Raman", githubUserId: "31577098" }),
  lucas: user({ login: "lucas-q-ferreira", name: "Lucas Ferreira", githubUserId: "56120952" }),
  renovate: user({
    login: "renovate[bot]",
    name: "Renovate",
    githubUserId: "29139614",
    bot: true,
  }),
  bot: user({ login: "ariakit-bot", name: "Ariakit Bot", githubUserId: "112503276", bot: true }),
} satisfies Record<string, User>;

/** The repository of every dataset. */
export const repository = "ariakit/ariakit";
