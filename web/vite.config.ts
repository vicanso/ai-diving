import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    base: "./",
    server: {
        host: "0.0.0.0",
        proxy: {
            "/api": {
                target: "http://127.0.0.1:5000",
                rewrite: (path) => path.replace(/^\/api/, ""),
            },
        },
    },
});
