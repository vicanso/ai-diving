import { useEffect, useState } from "react";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
    apiBase: string;
}

interface AnalysisRow {
    id: number;
    url: string;
    status: number;
    result: string | null;
    created: string;
    modified: string;
}

interface ParsedResult {
    diving_result: string;
    llm_result: string;
    elapsed_ms: number;
    is_same_as_last: boolean;
}

const STATUS_META: Record<
    number,
    { label: string; classes: string }
> = {
    0: {
        label: "等待中",
        classes:
            "bg-muted text-muted-foreground border border-border",
    },
    1: {
        label: "分析中",
        classes:
            "bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
    },
    2: {
        label: "已完成",
        classes:
            "bg-emerald-100 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
    },
    3: {
        label: "失败",
        classes:
            "bg-destructive/10 text-destructive border border-destructive/40 dark:bg-destructive/20",
    },
};

function formatTime(iso: string): string {
    const ts = iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-CN", { hour12: false });
}

function parseResult(row: AnalysisRow): ParsedResult | null {
    if (row.status !== 2 || !row.result) return null;
    try {
        return JSON.parse(row.result) as ParsedResult;
    } catch {
        return null;
    }
}

type FetchState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "loaded"; rows: AnalysisRow[] }
    | { kind: "error"; message: string };

export function WebQueryView({ apiBase }: Props) {
    const [url, setUrl] = useState("");
    const [urlSuggestions, setUrlSuggestions] = useState<string[]>([]);
    const [state, setState] = useState<FetchState>({ kind: "idle" });
    const [expandedId, setExpandedId] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`${apiBase}/web_page/urls`)
            .then((res) => (res.ok ? res.json() : []))
            .then((urls: string[]) => {
                if (!cancelled && Array.isArray(urls)) {
                    setUrlSuggestions(urls);
                }
            })
            .catch(() => {
                // 静默失败，下拉建议不可用不影响主流程
            });
        return () => {
            cancelled = true;
        };
    }, [apiBase]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const finalUrl = url.trim();
        setState({ kind: "loading" });

        const params = new URLSearchParams();
        if (finalUrl) params.set("url", finalUrl);

        try {
            const qs = params.toString();
            const res = await fetch(
                `${apiBase}/web_page/analyses${qs ? `?${qs}` : ""}`,
            );
            if (!res.ok) {
                const text = await res.text().catch(() => "");
                setState({
                    kind: "error",
                    message: `${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
                });
                return;
            }
            const rows = (await res.json()) as AnalysisRow[];
            setState({ kind: "loaded", rows });
            setExpandedId(null);
        } catch (err) {
            setState({
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const loading = state.kind === "loading";

    return (
        <>
            <CardContent className="flex flex-col gap-4">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="q-url">页面 URL（可留空查全局）</Label>
                        <Input
                            id="q-url"
                            placeholder="https://example.com"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            disabled={loading}
                            autoComplete="off"
                            spellCheck={false}
                            list="q-url-suggestions"
                        />
                        <datalist id="q-url-suggestions">
                            {urlSuggestions.map((u) => (
                                <option key={u} value={u} />
                            ))}
                        </datalist>
                    </div>

                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "查询中..." : "查询"}
                    </Button>
                </form>

                {state.kind === "error" && (
                    <p className="text-sm rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive dark:border-destructive/60 dark:bg-destructive/10">
                        ❌ 查询失败：{state.message}
                    </p>
                )}
            </CardContent>

            {state.kind === "loaded" && (
                <CardFooter className="flex-col items-stretch gap-3 pt-2">
                    {state.rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                            暂无记录
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {state.rows.map((row) => {
                                const meta = STATUS_META[row.status] ?? STATUS_META[0];
                                const expanded = expandedId === row.id;
                                const parsed = parseResult(row);
                                const failedReason =
                                    row.status === 3 ? row.result ?? "" : "";

                                return (
                                    <li
                                        key={row.id}
                                        className="rounded-lg border border-border bg-card overflow-hidden"
                                    >
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setExpandedId(expanded ? null : row.id)
                                            }
                                            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span
                                                    className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${meta.classes}`}
                                                >
                                                    {meta.label}
                                                </span>
                                                <span
                                                    className="text-sm font-medium truncate"
                                                    title={row.url}
                                                >
                                                    {row.url}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-xs text-muted-foreground">
                                                    {formatTime(row.created)}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {expanded ? "−" : "+"}
                                                </span>
                                            </div>
                                        </button>

                                        {expanded && (
                                            <div className="border-t border-border px-3 py-3 bg-muted/20">
                                                {parsed ? (
                                                    <>
                                                        <Markdown>{parsed.llm_result}</Markdown>
                                                        <details className="mt-3">
                                                            <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                                                                查看 diving 原始诊断（{parsed.elapsed_ms}ms）
                                                            </summary>
                                                            <div className="mt-2">
                                                                <Markdown>
                                                                    {parsed.diving_result}
                                                                </Markdown>
                                                            </div>
                                                        </details>
                                                    </>
                                                ) : failedReason ? (
                                                    <pre className="text-xs whitespace-pre-wrap break-all text-destructive">
                                                        {failedReason}
                                                    </pre>
                                                ) : (
                                                    <p className="text-sm text-muted-foreground">
                                                        分析尚未完成
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardFooter>
            )}
        </>
    );
}
