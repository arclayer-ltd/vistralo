import React from "react";
import { Menu, ToolButton, type MenuAction } from "../components/Primitives";
import { createFlows, flowFor, type CreateFlow } from "../features/create-flows";

/**
 * What the Record button starts. There is one way to record a screen now; whether it records
 * your voice is a choice inside it, remembered in this browser. Kept as a function so callers
 * that remembered a flow keep working.
 */
export function storedRecordFlow(): CreateFlow {
  return "screen";
}

export function rememberRecordFlow(_flow: CreateFlow) {
  /* Nothing to remember: Record always records your screen. */
}

/**
 * The one place a project starts from, in the same spot on every page: Record goes straight
 * to the browser's screen picker, and the button beside it lists every other way to begin.
 */
export function RecordControl({
  flow,
  create,
  menuOpen,
  onMenu,
  placement,
}: {
  flow: CreateFlow;
  /** `quick` is the Record button: straight to the browser's picker. */
  create: (flow: CreateFlow, quick?: boolean) => void;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  /** The rail on a computer, the top bar on a phone. */
  placement: "rail" | "bar";
}) {
  const current = flowFor(flow);
  const items: MenuAction[] = createFlows.map((item) => ({
    label: item.label,
    description: item.description,
    icon: item.icon,
    key: item.key,
    onClick: () => create(item.flow),
  }));
  return (
    <div
      className={`record-control record-control-${placement}`}
      role="group"
      aria-label="Create"
    >
      <button
        type="button"
        className="button button-record button-large record-button tooltip-host"
        aria-label="Record"
        aria-description={current.label}
        onClick={() => create(flow, true)}
      >
        <span className="record-label">Record</span>
        <span className="tooltip" role="tooltip">
          {current.label}
        </span>
      </button>
      <div className="menu-anchor">
        <ToolButton
          icon="add"
          label="New project"
          className="record-more"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-keyshortcuts="N"
          onClick={() => onMenu(!menuOpen)}
        />
        {menuOpen && (
          <Menu
            items={items}
            align={placement === "bar" ? "end" : "start"}
            onClose={() => onMenu(false)}
          />
        )}
      </div>
    </div>
  );
}
