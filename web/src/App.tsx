import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API_BASE = "/api";
const TOKEN = "bae95b6d-ed59-4516-b43d-ad39e493957f";

type Theme = "light" | "dark";

type SubmitState =
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "success"; id: number; email: string }
    | { kind: "error"; message: string };

function getInitialTheme(): Theme {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function SunIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    );
}

function App() {
    const [repoName, setRepoName] = useState("");
    const [tag, setTag] = useState("latest");
    const [email, setEmail] = useState("");
    const [state, setState] = useState<SubmitState>({ kind: "idle" });
    const [theme, setTheme] = useState<Theme>(getInitialTheme);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", theme === "dark");
        try {
            localStorage.setItem("theme", theme);
        } catch {
            // ignore
        }
    }, [theme]);

    const toggleTheme = () =>
        setTheme((prev) => (prev === "dark" ? "light" : "dark"));

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const finalTag = tag.trim() || "latest";
        const finalRepo = repoName.trim();
        const finalEmail = email.trim();
        setState({ kind: "submitting" });

        const params = new URLSearchParams({
            token: TOKEN,
            notify_type: "email",
            notify_data: finalEmail,
            notify_force: "true",
        });

        try {
            const res = await fetch(`${API_BASE}/docker/analyze?${params.toString()}`, {
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
        <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
            <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="fixed top-4 right-4"
                aria-label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
                title={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
            >
                {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </Button>

            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Docker 镜像分析</CardTitle>
                    <CardDescription>
                        提交一个公开的 Docker 镜像，分析完成后通过邮件发送报告。
                    </CardDescription>
                </CardHeader>
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
            </Card>
        </div>
    );
}

export default App;
