import React, { useEffect, useMemo, useState } from "react";
import type { Project, WorkspaceAdapter } from "../../contracts";
import { Icon } from "../../components/Icon";
import { StatusBadge, Thumbnail } from "../../components/ProjectCard";
import { projectTitle, relativeTime, scriptAwaiting, stalled, statusHint } from "../../utils";
import { createFlows, type CreateFlow } from "../create-flows";
import { KIND_LABELS, projectKind, type ProjectKind } from "../flow-utils";

/** What the plan allows and what has been used, when plans are switched on. */
export interface Usage {
  plan: string;
  projects: [number, number | null];
  jobs: [number, number | null];
}

const PLACEHOLDER_NAMES = new Set(["", "account", "demo user"]);

/** "Good afternoon, Rana", or just "Good afternoon" while the account's name is not known. */
export function greeting(name: string, now = new Date()) {
  const hour = now.getHours();
  const part = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0] || "";
  return PLACEHOLDER_NAMES.has(name.trim().toLowerCase()) || !first ? part : `${part}, ${first}`;
}

/** A project that is waiting on its owner, why, and the one thing that moves it on. */
type Attention = { project: Project; reason: string; action: string };

/** Failed jobs, stalled ones and drafted scripts waiting to be read, most recent first. */
export function needsAttention(projects: Project[], now = Date.now()): Attention[] {
  const items: Attention[] = [];
  for (const p of projects) {
    if (p.trashed) continue;
    const stall = stalled(p, now);
    if (stall) items.push({ project: p, reason: stall.reason, action: "Resolve" });
    else if (p.status === "failed") items.push({ project: p, reason: p.error || statusHint(p), action: "Fix" });
    else if (scriptAwaiting(p))
      items.push({ project: p, reason: "The AI walkthrough script is ready for you to read and approve.", action: "Review script" });
  }
  return items.sort((a, b) => Date.parse(b.project.updated) - Date.parse(a.project.updated));
}

const lastTouched = (p: Project) =>
  Math.max(Date.parse(p.lastOpened || "") || 0, Date.parse(p.eventAt || "") || 0, Date.parse(p.updated) || 0);

/**
 * The top of the Projects page: a greeting, the four ways to start, the work picked up most
 * recently, anything waiting on the owner, and a few facts about the workspace. The full
 * library sits below it.
 */
export function Welcome({
  projects,
  adapter,
  locale,
  name,
  usage,
  create,
  onOpen,
  onFolder,
}: {
  projects: Project[];
  adapter: WorkspaceAdapter;
  locale: string;
  name: string;
  usage: Usage | null;
  create: (flow: CreateFlow) => void;
  onOpen: (p: Project) => void;
  onFolder: (name: string) => void;
}) {
  const live = useMemo(() => projects.filter((p) => !p.trashed), [projects]);
  const recent = useMemo(
    () => [...live].sort((a, b) => lastTouched(b) - lastTouched(a)).slice(0, 4),
    [live],
  );
  const attention = useMemo(() => needsAttention(live), [live]);
  const facts = useMemo(() => {
    const status = { ready: 0, draft: 0, working: 0 };
    const kinds: Record<ProjectKind, number> = { screen: 0, website: 0, video: 0, images: 0 };
    const folders = new Map<string, number>();
    let narrated = 0,
      seconds = 0;
    for (const p of live) {
      if (p.status === "ready") status.ready++;
      else if (p.status === "draft") status.draft++;
      else if (p.status !== "failed") status.working++;
      kinds[projectKind(p)]++;
      if (p.data?.narratedVideo) narrated++;
      if (Number.isFinite(p.duration) && p.duration! > 0) seconds += p.duration!;
      const folder = (p.folder || "").trim();
      if (folder) folders.set(folder, (folders.get(folder) || 0) + 1);
    }
    const activity = [...live]
      .filter((p) => p.eventAt)
      .sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt))
      .slice(0, 5);
    return { status, kinds, folders: [...folders].sort((a, b) => b[1] - a[1]).slice(0, 5), narrated, seconds, activity };
  }, [live]);
  // Pictures for the recent frames, resolved the same way the library resolves a page of them.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const recentKey = recent.map((p) => `${p.id}:${p.thumbnail || ""}`).join("|");
  useEffect(() => {
    if (!adapter.thumbnails || !recent.length) return;
    let ignore = false;
    adapter
      .thumbnails(recent)
      .then((resolved) => !ignore && setThumbs((known) => ({ ...known, ...resolved })))
      .catch(() => {
        /* A frame without its picture still opens its project. */
      });
    return () => {
      ignore = true;
    };
  }, [adapter, recentKey]);
  const number = (value: number) => value.toLocaleString(locale);
  const hours = Math.floor(facts.seconds / 3600),
    minutes = Math.round((facts.seconds % 3600) / 60);
  const recorded = facts.seconds
    ? hours
      ? `${number(hours)} h ${minutes} min`
      : `${Math.max(1, minutes)} min`
    : "None yet";
  const empty = !live.length;
  const summary = empty
    ? "Start your first project below. Saving never starts paid AI; you choose when to add an AI walkthrough."
    : [
        `${number(live.length)} ${live.length === 1 ? "project" : "projects"}`,
        facts.status.ready ? `${number(facts.status.ready)} ready to share` : "",
        attention.length ? `${number(attention.length)} waiting on you` : "",
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <header className="welcome-header">
        <h1 id="welcome-title" tabIndex={-1}>
          {greeting(name)}
        </h1>
        <p className="welcome-summary">{summary}</p>
      </header>

      <section className="welcome-section" aria-labelledby="welcome-start">
        <h2 id="welcome-start" className="welcome-heading">
          Start something new
        </h2>
        <div className="welcome-actions">
          {createFlows.map((item) => (
            <button
              type="button"
              className="creation-tile welcome-action"
              key={item.flow}
              onClick={() => create(item.flow)}
            >
              <Icon name={item.icon} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="chevronRight" />
            </button>
          ))}
        </div>
      </section>

      {!empty && (
        <div className="welcome-columns">
          <section className="welcome-section welcome-recent" aria-labelledby="welcome-continue">
            <h2 id="welcome-continue" className="welcome-heading">
              Continue where you left off
            </h2>
            <ul className="welcome-frames">
              {recent.map((p) => (
                <li key={p.id}>
                  <a
                    className="welcome-frame"
                    href={`#${adapter.mode === "demo" ? "demo/" : ""}project/${p.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpen(p);
                    }}
                  >
                    <Thumbnail project={p} src={adapter.thumbnails ? thumbs[p.id] || "" : undefined} />
                    <span className="welcome-frame-meta edge">
                      {KIND_LABELS[projectKind(p)].one} · {relativeTime(p.eventAt || p.updated, locale)}
                    </span>
                    <span className="welcome-frame-title">{projectTitle(p, locale)}</span>
                  </a>
                  {p.status !== "ready" && <StatusBadge project={p} />}
                </li>
              ))}
            </ul>
          </section>

          <section className="welcome-section welcome-attention" aria-labelledby="welcome-needs">
            <h2 id="welcome-needs" className="welcome-heading">
              Needs your attention
              {attention.length > 0 && <span className="welcome-count edge">{number(attention.length)}</span>}
            </h2>
            {attention.length ? (
              <ul className="welcome-list">
                {attention.slice(0, 5).map(({ project: p, reason, action }) => (
                  <li key={p.id}>
                    <Icon name={action === "Review script" ? "sparkle" : "warning"} />
                    <span className="welcome-list-text">
                      <strong>{projectTitle(p, locale)}</strong>
                      <small>{reason}</small>
                    </span>
                    <button
                      type="button"
                      className="button"
                      aria-label={`${action}: ${projectTitle(p, locale)}`}
                      onClick={() => onOpen(p)}
                    >
                      {action}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="welcome-clear">
                <Icon name="checkCircle" />
                Nothing is waiting on you. Failed jobs and AI scripts to review show up here.
              </p>
            )}
          </section>
        </div>
      )}

      {!empty && (
        <section className="welcome-section" aria-labelledby="welcome-glance">
          <h2 id="welcome-glance" className="welcome-heading">
            At a glance
          </h2>
          <div className="welcome-facts">
            <dl className="welcome-stats" aria-label="Projects by state">
              {(
                [
                  ["Ready", facts.status.ready],
                  ["Drafts", facts.status.draft],
                  ["Working", facts.status.working],
                  ["AI walkthroughs", facts.narrated],
                ] as [string, number][]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="edge">{number(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="welcome-fact">
              <h3>Made from</h3>
              <ul className="welcome-bars">
                {(Object.keys(KIND_LABELS) as ProjectKind[]).map((kind) => (
                  <li key={kind}>
                    <Icon name={KIND_LABELS[kind].icon} size={16} />
                    <span>{KIND_LABELS[kind].many}</span>
                    <span className="edge">{number(facts.kinds[kind])}</span>
                  </li>
                ))}
              </ul>
              <p className="welcome-note">Video in the library: {recorded}</p>
            </div>
            <div className="welcome-fact">
              <h3>Recent activity</h3>
              <ol className="welcome-activity">
                {facts.activity.map((p) => (
                  <li key={p.id}>
                    <span className="edge">{relativeTime(p.eventAt, locale)}</span>
                    <span>
                      {p.eventLabel || "Updated"}{" "}
                      <button type="button" className="link-button" onClick={() => onOpen(p)}>
                        {projectTitle(p, locale)}
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="welcome-fact">
              {usage ? (
                <>
                  <h3>{usage.plan} plan this month</h3>
                  <ul className="welcome-bars">
                    <li>
                      <span>Projects</span>
                      <span className="edge">
                        {number(usage.projects[0])}
                        {usage.projects[1] !== null ? ` of ${number(usage.projects[1])}` : ""}
                      </span>
                    </li>
                    <li>
                      <span>AI walkthroughs and websites</span>
                      <span className="edge">
                        {number(usage.jobs[0])}
                        {usage.jobs[1] !== null ? ` of ${number(usage.jobs[1])}` : ""}
                      </span>
                    </li>
                  </ul>
                </>
              ) : null}
              <h3>Folders</h3>
              {facts.folders.length ? (
                <ul className="welcome-bars">
                  {facts.folders.map(([folder, count]) => (
                    <li key={folder}>
                      <Icon name="folder" size={16} />
                      <button type="button" className="link-button" onClick={() => onFolder(folder)}>
                        {folder}
                      </button>
                      <span className="edge">{number(count)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="welcome-note">
                  No folders yet. Use Move to on a project to start one.
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
