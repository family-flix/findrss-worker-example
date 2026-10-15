import logo from "../public/brand/favicon.svg";
import all from "../public/platform-icons/all.svg";
import website from "../public/platform-icons/website.svg";
import bilibili from "../public/platform-icons/bilibili.svg";
import douyin from "../public/platform-icons/douyin.svg";
import wxchannels from "../public/platform-icons/wxchannels.svg";
import wxmp from "../public/platform-icons/wxmp.svg";
import zhihu from "../public/platform-icons/zhihu.svg";
import x from "../public/platform-icons/x.svg";
import xiaohongshu from "../public/platform-icons/xiaohongshu.svg";
import weibo from "../public/platform-icons/weibo.svg";
import kuaishou from "../public/platform-icons/kuaishou.svg";
import youtube from "../public/platform-icons/youtube.svg";
import instagram from "../public/platform-icons/instagram.svg";
import telegram from "../public/platform-icons/telegram.svg";

const svg_url = (source) => "data:image/svg+xml," + encodeURIComponent(source);
export const logo_url = svg_url(logo);
export const platform_icons = Object.fromEntries(
  Object.entries({
    all,
    website,
    bilibili,
    douyin,
    wxchannels,
    wxmp,
    zhihu,
    x,
    xiaohongshu,
    weibo,
    kuaishou,
    youtube,
    instagram,
    telegram,
  }).map(([name, source]) => [name, svg_url(source)]),
);
