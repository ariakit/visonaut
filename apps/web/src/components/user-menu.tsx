import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { ButtonLabel, ButtonSlot } from "./ariakit/components/button.ariakit.react.tsx";
import {
  Popover,
  PopoverDescription,
  PopoverDisclosure,
  PopoverHeading,
  PopoverProvider,
} from "./ariakit/components/popover.ariakit.react.tsx";
import { Text } from "./ariakit/components/text.ariakit.react.tsx";
import { ControlButton } from "./control-button.tsx";

export interface UserMenuProps {
  login?: string;
  preview?: boolean;
  signingOut?: boolean;
  error?: string;
  onSignOut?: () => void;
}

export function UserMenu({ login, preview, signingOut, error, onSignOut }: UserMenuProps) {
  const [menu, setMenu] = useState({ open: Boolean(error), error });
  const accountLabel = preview ? "Preview account" : login ? `@${login}` : "Account";

  if (error !== menu.error) {
    setMenu({ open: error ? true : menu.open, error });
  }

  return (
    <PopoverProvider
      placement="bottom-end"
      open={menu.open}
      setOpen={(open) => setMenu({ open, error })}
    >
      <PopoverDisclosure
        $kind="flat"
        $rounded="lg"
        $p={2}
        aria-label={preview ? "Preview account menu" : "Account menu"}
        className="shrink-0"
      >
        <ButtonSlot>
          <UserRound />
        </ButtonSlot>
        <ButtonLabel className="hidden max-w-36 truncate sm:inline">{accountLabel}</ButtonLabel>
        <ButtonSlot $size="sm" className="hidden sm:flex">
          <ChevronDown />
        </ButtonSlot>
      </PopoverDisclosure>
      <Popover
        portal
        $rounded="xl"
        $p={4}
        className="flex w-64 max-w-[calc(100vw-24px)] flex-col gap-3 text-sm"
      >
        <div className="grid gap-1">
          <PopoverHeading className="break-all text-base!">{accountLabel}</PopoverHeading>
          <PopoverDescription className="text-xs leading-5">
            {preview
              ? "This preview uses sample data. Account actions are unavailable."
              : "Manage your GitHub session."}
          </PopoverDescription>
        </div>
        {error && (
          <Text render={<p />} role="alert" className="text-xs ak-ink-danger">
            {error}
          </Text>
        )}
        {!preview && onSignOut && (
          <ControlButton disabled={signingOut} onClick={onSignOut} className="w-full justify-start">
            <ButtonSlot>
              <LogOut />
            </ButtonSlot>
            <ButtonLabel>{signingOut ? "Signing out…" : "Sign out"}</ButtonLabel>
          </ControlButton>
        )}
      </Popover>
    </PopoverProvider>
  );
}
