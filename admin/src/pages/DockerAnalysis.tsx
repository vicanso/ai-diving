"use client";
import { Fragment, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useShallow } from "zustand/react/shallow";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import dayjs from "dayjs";

import request from "@/helpers/request";
import { formatError } from "@/helpers/util";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import useBasicState from "@/states/basic";

interface AnalysisRow {
    id: number;
    repo_name: string;
    tag: string;
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

const STATUS_CLASSES: Record<number, string> = {
    0: "bg-muted text-muted-foreground border-border",
    1: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
    2: "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
    3: "bg-destructive/10 text-destructive border-destructive/40 dark:bg-destructive/20",
};

// 后端 chrono::NaiveDateTime 序列化为不带时区的 ISO（如 "2026-05-10T12:34:56"）。
// 数据库实际存的是 UTC，这里显式补 Z 后让 dayjs 按 UTC 解析、再用本地时区格式化。
function formatLocalTime(s: string): string {
    if (!s) return "--";
    const ts = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
    return dayjs(ts).format("YYYY-MM-DD HH:mm:ss");
}

function parseResult(row: AnalysisRow): ParsedResult | null {
    if (row.status !== 2 || !row.result) return null;
    try {
        return JSON.parse(row.result) as ParsedResult;
    } catch {
        return null;
    }
}

function MarkdownView({ children }: { children: string }) {
    return (
        <div
            className={cn(
                "text-sm leading-relaxed space-y-3",
                "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4",
                "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4",
                "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3",
                "[&_p]:my-2",
                "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1",
                "[&_ol]:list-decimal [&_ol]:pl-5",
                "[&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs",
                "[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-auto [&_pre]:text-xs",
                "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                "[&_strong]:font-semibold",
                "[&_a]:text-primary [&_a]:underline",
                "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
                "[&_table]:border [&_table]:border-border [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
                "[&_hr]:my-4 [&_hr]:border-border",
            )}
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
        </div>
    );
}

export default function DockerAnalysis() {
    const i18n = useI18n("dockerAnalysis");
    const [setPageHeaderNavigation, resetPageHeaderNavigation] = useBasicState(
        useShallow((state) => [
            state.setPageHeaderNavigation,
            state.resetPageHeaderNavigation,
        ]),
    );

    const [repoName, setRepoName] = useState("");
    const [rows, setRows] = useState<AnalysisRow[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState<number | null>(null);

    useEffect(() => {
        setPageHeaderNavigation([{ title: i18n("title") }]);
        return () => {
            resetPageHeaderNavigation();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const finalRepo = repoName.trim();
        setLoading(true);
        setExpandedId(null);
        try {
            const res = await request.get<AnalysisRow[]>("/docker/analyses", {
                params: { repo_name: finalRepo },
            });
            setRows(res.data);
        } catch (err) {
            toast.error(formatError(err));
            setRows(null);
        } finally {
            setLoading(false);
        }
    };

    const statusLabel = (status: number) => {
        switch (status) {
            case 0:
                return i18n("statusWaiting");
            case 1:
                return i18n("statusProcessing");
            case 2:
                return i18n("statusCompleted");
            case 3:
                return i18n("statusFailed");
            default:
                return String(status);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader>
                    <CardTitle>{i18n("title")}</CardTitle>
                    <CardDescription>{i18n("description")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-2 sm:flex-row sm:items-end"
                    >
                        <div className="grid flex-1 gap-2">
                            <Label htmlFor="repo-name">{i18n("repoName")}</Label>
                            <Input
                                id="repo-name"
                                placeholder={i18n("repoNamePlaceholder")}
                                value={repoName}
                                onChange={(e) => setRepoName(e.target.value)}
                                disabled={loading}
                                autoComplete="off"
                            />
                        </div>
                        <Button type="submit" disabled={loading}>
                            {loading ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <SearchIcon />
                            )}
                            {loading ? i18n("searching") : i18n("search")}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {rows !== null && (
                <Card>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[40px]" />
                                    <TableHead>{i18n("columnTag")}</TableHead>
                                    <TableHead className="w-[120px]">
                                        {i18n("columnStatus")}
                                    </TableHead>
                                    <TableHead className="w-[180px]">
                                        {i18n("columnCreated")}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.length === 0 && (
                                    <TableRow>
                                        <TableCell
                                            colSpan={4}
                                            className="text-center text-muted-foreground py-6"
                                        >
                                            {i18n("noRecords")}
                                        </TableCell>
                                    </TableRow>
                                )}
                                {rows.map((row) => {
                                    const expanded = expandedId === row.id;
                                    const parsed = parseResult(row);
                                    const failedReason =
                                        row.status === 3 ? row.result ?? "" : "";
                                    return (
                                        <Fragment key={row.id}>
                                            <TableRow
                                                onClick={() =>
                                                    setExpandedId(
                                                        expanded ? null : row.id,
                                                    )
                                                }
                                                className="cursor-pointer hover:bg-muted/50"
                                            >
                                                <TableCell>
                                                    {expanded ? (
                                                        <ChevronDownIcon className="size-4 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronRightIcon className="size-4 text-muted-foreground" />
                                                    )}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {row.repo_name}:{row.tag}
                                                </TableCell>
                                                <TableCell>
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
                                                            STATUS_CLASSES[row.status] ??
                                                                STATUS_CLASSES[0],
                                                        )}
                                                    >
                                                        {statusLabel(row.status)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                                    {formatLocalTime(row.created)}
                                                </TableCell>
                                            </TableRow>
                                            {expanded && (
                                                <TableRow className="bg-muted/30 hover:bg-muted/30">
                                                    <TableCell colSpan={4} className="py-4">
                                                        {parsed ? (
                                                            <>
                                                                <MarkdownView>
                                                                    {parsed.llm_result}
                                                                </MarkdownView>
                                                                <details className="mt-3">
                                                                    <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                                                                        {i18n("diving")}（
                                                                        {parsed.elapsed_ms}
                                                                        ms）
                                                                    </summary>
                                                                    <div className="mt-2">
                                                                        <MarkdownView>
                                                                            {parsed.diving_result}
                                                                        </MarkdownView>
                                                                    </div>
                                                                </details>
                                                            </>
                                                        ) : failedReason ? (
                                                            <pre className="text-xs whitespace-pre-wrap break-all text-destructive">
                                                                {failedReason}
                                                            </pre>
                                                        ) : (
                                                            <p className="text-sm text-muted-foreground">
                                                                {i18n("incomplete")}
                                                            </p>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
