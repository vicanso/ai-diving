import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
    children: string;
}

export function Markdown({ children }: Props) {
    return (
        <div
            className={[
                "text-sm leading-relaxed space-y-3",
                "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4",
                "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4",
                "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3",
                "[&_p]:my-2",
                "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1",
                "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1",
                "[&_li]:marker:text-muted-foreground",
                "[&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs",
                "[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-auto [&_pre]:text-xs",
                "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                "[&_strong]:font-semibold",
                "[&_em]:italic",
                "[&_a]:text-primary [&_a]:underline",
                "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
                "[&_table]:border [&_table]:border-border [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
                "[&_hr]:my-4 [&_hr]:border-border",
            ].join(" ")}
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
        </div>
    );
}
