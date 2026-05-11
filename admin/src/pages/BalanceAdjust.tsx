"use client";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

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

import { MODEL_SEARCH } from "@/constants/url";
import request from "@/helpers/request";
import { formatError } from "@/helpers/util";
import { useI18n } from "@/i18n";
import useBasicState from "@/states/basic";

interface AdjustResp {
    new_balance: number;
}

interface UserOption {
    label: string;
    value: number | string;
}

interface UserSelectProps {
    value: number | null;
    onChange: (id: number | null) => void;
    disabled?: boolean;
    placeholder?: string;
}

function UserSelect({ value, onChange, disabled, placeholder }: UserSelectProps) {
    const [inputValue, setInputValue] = useState("");
    const [options, setOptions] = useState<UserOption[]>([]);
    const [showList, setShowList] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectedLabel = useRef("");

    useEffect(() => {
        if (value === null) {
            selectedLabel.current = "";
            setInputValue("");
            setOptions([]);
        }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const keyword = e.target.value;
        setInputValue(keyword);
        setShowList(true);
        // 输入变化即视为重新选择，清空已选 user_id
        if (value !== null) onChange(null);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
            try {
                const { data } = await request.get<{ options: UserOption[] }>(
                    MODEL_SEARCH,
                    { params: { model: "user", keyword } },
                );
                setOptions(data.options ?? []);
            } catch {
                setOptions([]);
            }
        }, 300);
    };

    const handleSelect = (option: UserOption) => {
        const numericValue = Number(option.value);
        selectedLabel.current = option.label;
        setInputValue(option.label);
        setOptions([]);
        setShowList(false);
        if (Number.isFinite(numericValue)) {
            onChange(numericValue);
        }
    };

    return (
        <div className="relative">
            <Input
                value={inputValue}
                disabled={disabled}
                onChange={handleChange}
                onBlur={() => {
                    setShowList(false);
                    setInputValue(selectedLabel.current);
                }}
                onFocus={() => setShowList(options.length > 0)}
                placeholder={placeholder}
                autoComplete="off"
                spellCheck={false}
            />
            {showList && options.length > 0 && (
                <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border bg-popover shadow-md">
                    {options.map((option) => (
                        <li
                            key={option.value}
                            className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelect(option);
                            }}
                        >
                            {option.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function BalanceAdjust() {
    const i18n = useI18n("balanceAdjust");
    const [setPageHeaderNavigation, resetPageHeaderNavigation] = useBasicState(
        useShallow((state) => [
            state.setPageHeaderNavigation,
            state.resetPageHeaderNavigation,
        ]),
    );

    const [userId, setUserId] = useState<number | null>(null);
    const [amount, setAmount] = useState("");
    const [remark, setRemark] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [newBalance, setNewBalance] = useState<number | null>(null);

    useEffect(() => {
        setPageHeaderNavigation([{ title: i18n("title") }]);
        return () => {
            resetPageHeaderNavigation();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (userId === null || userId <= 0) {
            toast.error(i18n("errInvalidUserId"));
            return;
        }
        const amt = Number.parseInt(amount.trim(), 10);
        if (!Number.isFinite(amt) || amt === 0) {
            toast.error(i18n("errInvalidAmount"));
            return;
        }
        setSubmitting(true);
        try {
            const res = await request.post<AdjustResp>("/token/balance/adjust", {
                user_id: userId,
                amount: amt,
                remark: remark.trim(),
            });
            setNewBalance(res.data.new_balance);
            toast.success(i18n("submitSuccess"));
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <Card className="w-full max-w-xl">
                <CardHeader>
                    <CardTitle>{i18n("title")}</CardTitle>
                    <CardDescription>{i18n("description")}</CardDescription>
                </CardHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                    <CardContent className="flex flex-col gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="user-account">
                                {i18n("userAccount")}{" "}
                                <span className="text-destructive">*</span>
                            </Label>
                            <UserSelect
                                value={userId}
                                onChange={setUserId}
                                disabled={submitting}
                                placeholder={i18n("userAccountPlaceholder")}
                            />
                            {userId !== null && (
                                <p className="text-xs text-muted-foreground">
                                    {i18n("selectedUserId")}: {userId}
                                </p>
                            )}
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="amount">
                                {i18n("amount")} <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="amount"
                                type="number"
                                placeholder="100000 / -50000"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                disabled={submitting}
                                required
                                autoComplete="off"
                            />
                            <p className="text-xs text-muted-foreground">
                                {i18n("amountHelp")}
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="remark">{i18n("remark")}</Label>
                            <Input
                                id="remark"
                                placeholder={i18n("remarkPlaceholder")}
                                value={remark}
                                onChange={(e) => setRemark(e.target.value)}
                                disabled={submitting}
                                autoComplete="off"
                            />
                        </div>

                        {newBalance !== null && (
                            <p className="text-sm rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                                ✅ {i18n("newBalance")}：{newBalance}
                            </p>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={submitting || userId === null}
                        >
                            {submitting && <Loader2Icon className="animate-spin" />}
                            {submitting ? i18n("submitting") : i18n("submit")}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
}
