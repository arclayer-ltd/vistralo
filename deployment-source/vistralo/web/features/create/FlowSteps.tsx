import React from "react";
import { Icon } from "../../components/Icon";

/**
 * Where the person is in a create flow: every step by name, the finished ones ticked and the
 * current one marked for screen readers with aria-current.
 */
export function FlowSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flow-steps" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map((step, index) => (
        <li
          key={step}
          className={index < current ? "is-done" : index === current ? "is-current" : ""}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="flow-step-mark" aria-hidden="true">
            {index < current ? <Icon name="check" size={14} /> : index + 1}
          </span>
          <span className="flow-step-name">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** The last step's reminder that saving starts nothing paid. */
export function AiLaterNote({ offered }: { offered: boolean }) {
  return (
    <p className="sheet-note flow-ai-later">
      <Icon name="sparkle" />
      <span>
        {offered
          ? "Saving doesn't start any AI. When it's saved, you can add an AI walkthrough from the project: Vistralo drafts the narration, you read and edit it, then it is voiced."
          : "Saving doesn't start any AI. AI walkthroughs can be added to a saved video in a Vistralo cloud workspace."}
      </span>
    </p>
  );
}

/** What is about to be saved, as label and value pairs. */
export function SaveSummary({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="flow-summary">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
