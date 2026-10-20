import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "麦麦刚刚好 · 吃你想吃的，省真正的钱",
  description: "先选真正想吃的，再让优惠来配合你。透明比较餐品金额、不为凑单加餐的点餐决策助手。开发者挑战赛独立参赛作品，当前为合成数据演示。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
