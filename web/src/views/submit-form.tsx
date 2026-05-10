import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEFAULT_TOKEN = "bae95b6d-ed59-4516-b43d-ad39e493957f";

type SubmitState =
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "success"; id: number; email: string }
    | { kind: "error"; message: string };

interface Props {
    apiBase: string;
}

export function SubmitForm({ apiBase }: Props) {
    const [repoName, setRepoName] = useState("");
    const [tag, setTag] = useState("latest");
    const [email, setEmail] = useState("");
    const [token, setToken] = useState(DEFAULT_TOKEN);
    const [notifyForce, setNotifyForce] = useState(false);
    const [state, setState] = useState<SubmitState>({ kind: "idle" });

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const finalTag = tag.trim() || "latest";
        const finalRepo = repoName.trim();
        const finalEmail = email.trim();
        const finalToken = token.trim();
        setState({ kind: "submitting" });

        const params = new URLSearchParams({
            token: finalToken,
            notify_type: "email",
            notify_data: finalEmail,
            notify_force: notifyForce ? "true" : "false",
        });

        try {
            const res = await fetch(`${apiBase}/docker/analyze?${params.toString()}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    push_data: { tag: finalTag },
                    repository: { repo_name: finalRepo },
                }),
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
            setState({ kind: "success", id: data.id, email: finalEmail });
        } catch (err) {
            setState({
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const submitting = state.kind === "submitting";

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="repo">
                        镜像仓库名 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="repo"
                        placeholder="vicanso/static"
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value)}
                        required
                        disabled={submitting}
                        autoComplete="off"
                    />
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="tag">Tag</Label>
                    <Input
                        id="tag"
                        placeholder="latest"
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                        disabled={submitting}
                        autoComplete="off"
                    />
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="email">
                        接收邮箱 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={submitting}
                        autoComplete="email"
                    />
                </div>

                <div className="flex items-start gap-2">
                    <Checkbox
                        id="notify-force"
                        checked={notifyForce}
                        onCheckedChange={(v) => setNotifyForce(v === true)}
                        disabled={submitting}
                        className="mt-0.5"
                    />
                    <div className="grid gap-1">
                        <Label htmlFor="notify-force" className="cursor-pointer">
                            强制发送邮件
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            默认情况下，分析结论与上次一致时会静默不发邮件。勾选后即使结论一致也仍然发送。
                        </p>
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="token">
                        API Token <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="token"
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
                        ✅ 已提交（任务 ID #{state.id}），完成后会发送邮件至 {state.email}。
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
