import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { SubmitForm } from "@/views/submit-form";
import { QueryView } from "@/views/query-view";
import { WebSubmitForm } from "@/views/web-submit-form";
import { WebQueryView } from "@/views/web-query-view";
import logoUrl from "@/logo.png";

const API_BASE = "/api";

type Theme = "light" | "dark";

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

    return (
        <div className="min-h-screen flex items-start justify-center p-6 bg-muted/30">
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

            <div className="w-full max-w-2xl flex flex-col gap-4">
                <div className="flex items-center justify-center gap-3">
                    <img
                        src={logoUrl}
                        alt="AI Diving"
                        className="size-9 rounded"
                    />
                    <span className="text-lg font-semibold tracking-tight">
                        AI Diving
                    </span>
                </div>

                <Tabs defaultValue="image-submit" className="w-full flex flex-col gap-3">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="image-submit">镜像分析</TabsTrigger>
                        <TabsTrigger value="image-query">镜像查询</TabsTrigger>
                        <TabsTrigger value="web-submit">网页分析</TabsTrigger>
                        <TabsTrigger value="web-query">网页查询</TabsTrigger>
                    </TabsList>

                    <TabsContent value="image-submit">
                        <Card>
                            <CardHeader>
                                <CardTitle>提交镜像分析</CardTitle>
                                <CardDescription>
                                    提交一个公开的 Docker 镜像，分析完成后通过邮件或企业微信发送报告。
                                </CardDescription>
                            </CardHeader>
                            <SubmitForm apiBase={API_BASE} />
                        </Card>
                    </TabsContent>

                    <TabsContent value="image-query">
                        <Card>
                            <CardHeader>
                                <CardTitle>查询镜像分析历史</CardTitle>
                                <CardDescription>
                                    按镜像仓库名查询最近 20 条分析记录，按时间倒序。
                                </CardDescription>
                            </CardHeader>
                            <QueryView apiBase={API_BASE} />
                        </Card>
                    </TabsContent>

                    <TabsContent value="web-submit">
                        <Card>
                            <CardHeader>
                                <CardTitle>提交网页分析</CardTitle>
                                <CardDescription>
                                    提交一个公开访问的页面 URL，分析 Core Web Vitals、阻塞资源、图片浪费等，完成后通过邮件或企业微信发送报告。
                                </CardDescription>
                            </CardHeader>
                            <WebSubmitForm apiBase={API_BASE} />
                        </Card>
                    </TabsContent>

                    <TabsContent value="web-query">
                        <Card>
                            <CardHeader>
                                <CardTitle>查询网页分析历史</CardTitle>
                                <CardDescription>
                                    按页面 URL 查询最近 20 条分析记录，按时间倒序；留空则查最近全局记录。
                                </CardDescription>
                            </CardHeader>
                            <WebQueryView apiBase={API_BASE} />
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}

export default App;
