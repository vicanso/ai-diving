import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEFAULT_TOKEN = "bae95b6d-ed59-4516-b43d-ad39e493957f";
const STORAGE_KEY = "aidiving:web-submit";

type NotifyType = "email" | "wecom";

interface Persisted {
    url: string;
    waitUntilLoad: boolean;
    waitForElement: string;
    notifyType: NotifyType;
    notifyData: string;
    notifyForce: boolean;
}

function loadPersisted(): Partial<Persisted> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

type SubmitState =
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "success"; id: number; notifyType: NotifyType; notifyData: string }
    | { kind: "error"; message: string };

interface Props {
    apiBase: string;
}

export function WebSubmitForm({ apiBase }: Props) {
    const initial = useMemo(loadPersisted, []);
    const [url, setUrl] = useState(initial.url ?? "");
    const [waitUntilLoad, setWaitUntilLoad] = useState(initial.waitUntilLoad ?? true);
    const [waitForElement, setWaitForElement] = useState(initial.waitForElement ?? "");
    const [notifyType, setNotifyType] = useState<NotifyType>(
        initial.notifyType === "wecom" || initial.notifyType === "email"
            ? initial.notifyType
            : "email",
    );
    const [notifyData, setNotifyData] = useState(initial.notifyData ?? "");
    const [token, setToken] = useState(DEFAULT_TOKEN);
    const [notifyForce, setNotifyForce] = useState(initial.notifyForce ?? false);
    const [state, setState] = useState<SubmitState>({ kind: "idle" });

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const payload: Persisted = {
                url,
                waitUntilLoad,
                waitForElement,
                notifyType,
                notifyData,
                notifyForce,
            };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // 静默忽略
        }
    }, [url, waitUntilLoad, waitForElement, notifyType, notifyData, notifyForce]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const finalUrl = url.trim();
        const finalNotifyData = notifyData.trim();
        const finalToken = token.trim();

        if (!/^https?:\/\//i.test(finalUrl)) {
            setState({
                kind: "error",
                message: "URL 需以 http:// 或 https:// 开头",
            });
            return;
        }

        setState({ kind: "submitting" });

        const params = new URLSearchParams({
            token: finalToken,
            notify_type: notifyType,
            notify_data: finalNotifyData,
            notify_force: notifyForce ? "true" : "false",
        });

        const trimmedElement = waitForElement.trim();
        const body: {
            url: string;
            wait_until_load: boolean;
            wait_for_element?: string;
        } = {
            url: finalUrl,
            wait_until_load: waitUntilLoad,
        };
        if (trimmedElement) {
            body.wait_for_element = trimmedElement;
        }

        try {
            const res = await fetch(`${apiBase}/web_page/analyze?${params.toString()}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => "");
                setState({
                    kind: "error",
                    message: `${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
                });
                return;
            }
            const data = (await res.json()) as { id: number };
            setState({
                kind: "success",
                id: data.id,
                notifyType,
                notifyData: finalNotifyData,
            });
        } catch (err) {
            setState({
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const submitting = state.kind === "submitting";

    const switchNotifyType = (t: NotifyType) => {
        if (t === notifyType) return;
        setNotifyType(t);
        setNotifyData("");
    };

    const isEmail = notifyType === "email";
    const notifyLabel = isEmail ? "接收邮箱" : "企业微信机器人 Key";
    const notifyPlaceholder = isEmail
        ? "you@example.com"
        : "WeCom 机器人 webhook URL 中 ?key= 之后那段";
    const successText =
        state.kind === "success"
            ? state.notifyType === "email"
                ? `完成后会发送邮件至 ${state.notifyData}。`
                : `完成后会推送至企业微信机器人。`
            : "";

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="w-url">
                        页面 URL <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="w-url"
                        type="url"
                        placeholder="https://example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        required
                        disabled={submitting}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>

                <div className="flex items-start gap-2">
                    <Checkbox
                        id="w-wait-until-load"
                        checked={waitUntilLoad}
                        onCheckedChange={(v) => setWaitUntilLoad(v === true)}
                        disabled={submitting}
                        className="mt-0.5"
                    />
                    <div className="grid gap-1">
                        <Label htmlFor="w-wait-until-load" className="cursor-pointer">
                            等待 onload 即分析
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            勾选时 diving 在 load 事件后即返回；取消时会等到 networkIdle（更彻底但更慢，适合长轮询站点）。默认勾选。
                        </p>
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="w-wait-for-element">等待元素出现（可选）</Label>
                    <Input
                        id="w-wait-for-element"
                        placeholder="#root / .main-content"
                        value={waitForElement}
                        onChange={(e) => setWaitForElement(e.target.value)}
                        disabled={submitting}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">
                        diving 在采集前等待匹配该 CSS 选择器的元素出现，适合 SPA 真实内容晚于 onload 渲染的场景。
                    </p>
                </div>

                <div className="grid gap-2">
                    <Label>通知方式</Label>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant={isEmail ? "default" : "outline"}
                            size="sm"
                            onClick={() => switchNotifyType("email")}
                            disabled={submitting}
                            className="flex-1"
                        >
                            邮件
                        </Button>
                        <Button
                            type="button"
                            variant={!isEmail ? "default" : "outline"}
                            size="sm"
                            onClick={() => switchNotifyType("wecom")}
                            disabled={submitting}
                            className="flex-1"
                        >
                            企业微信
                        </Button>
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="w-notify-data">
                        {notifyLabel} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="w-notify-data"
                        type={isEmail ? "email" : "text"}
                        placeholder={notifyPlaceholder}
                        value={notifyData}
                        onChange={(e) => setNotifyData(e.target.value)}
                        required
                        disabled={submitting}
                        autoComplete={isEmail ? "email" : "off"}
                        spellCheck={false}
                    />
                </div>

                <div className="flex items-start gap-2">
                    <Checkbox
                        id="w-notify-force"
                        checked={notifyForce}
                        onCheckedChange={(v) => setNotifyForce(v === true)}
                        disabled={submitting}
                        className="mt-0.5"
                    />
                    <div className="grid gap-1">
                        <Label htmlFor="w-notify-force" className="cursor-pointer">
                            强制推送
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            默认情况下，分析结论与上次一致时会静默不推送。勾选后即使结论一致也仍然发送。
                        </p>
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="w-token">
                        API Token <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="w-token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        required
                        readOnly
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <p className="text-xs text-muted-foreground">
                        后续放开注册即可使用自己的 token 替换。
                    </p>
                </div>

                {state.kind === "success" && (
                    <p className="text-sm rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                        ✅ 已提交（任务 ID #{state.id}），{successText}
                    </p>
                )}
                {state.kind === "error" && (
                    <p className="text-sm rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive dark:border-destructive/60 dark:bg-destructive/10">
                        ❌ 提交失败：{state.message}
                    </p>
                )}
            </CardContent>

            <CardFooter>
                <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? "提交中..." : "开始分析"}
                </Button>
            </CardFooter>
        </form>
    );
}
