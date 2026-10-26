import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "微博",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="weibo-platform-icon"><path fill="red" d="M1 18c-1-5 3-9 9-10 1-3 4-5 7-4 3 1 3 4 2 6 5 1 9 4 9 8 0 6-8 11-16 11C5 29 1 25 1 18Z" data-n="weibo-icon-path-1" /><path fill="#fff" d="M5 21c0-4 4-6 9-6s9 2 9 6-4 6-9 6-9-2-9-6Z" data-n="weibo-icon-path-2" /><circle cx="13" cy="21" r="3.2" data-n="weibo-icon-circle-3" /><circle cx="12" cy="20" r=".8" fill="#fff" data-n="weibo-icon-circle-4" /><path fill="none" stroke="#ff0" stroke-linecap="round" stroke-width="1.6" d="M22 9c3 1 5 3 6 6M23 6c4 1 7 4 8 8" data-n="weibo-icon-path-5" /></svg>',
};

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://weibo.com",
      path_prefix: "/",
      names: ["SUB", "SUBP", "ALF", "SSOLoginState", "XSRF-TOKEN"],
      purpose: "读取用户授权的 微博用户列表 页面或接口",
    },
    {
      id: "account_1",
      origin: "https://www.weibo.com",
      path_prefix: "/",
      names: ["SUB", "SUBP", "ALF", "SSOLoginState", "XSRF-TOKEN"],
      purpose: "读取用户授权的 微博用户列表 页面或接口",
    },
  ],
};
export class WeiboRSS extends RSSScript {
  static image_hosts = ["wx", "ww", "tva", "tvax"]
    .flatMap(function (prefix) {
      return [1, 2, 3, 4].map(function (index) {
        return prefix + index + ".sinaimg.cn";
      });
    })
    .concat("face.t.sinajs.cn");
  static weibo_emojis = {
    "[不愧是你]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/2b/2025_ItsYou_mobile.png",
    "[流鼻血]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/89/2025_liubixie_mobile.png",
    "[泪奔]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d6/2025_ShedTears_mobile.png",
    "[期待]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/37/2025_qidai_mobile.png",
    "[无聊]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/5c/2025_bored_mobile.png",
    "[皱眉]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/5f/2025_frown_mobile.png",
    "[震惊]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/54/2025_shock_mobile.png",
    "[点赞]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/07/2025_like_mobile.png",
    "[呵呵]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d4/2025_hehe_mobile.png",
    "[拜托]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/52/2025_please_mobile.png",
    "[yeah]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/56/2025_yeah_mobile.png",
    "[惊恐]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e8/2025_jingkong_mobile.png",
    "[卡皮巴拉]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e3/2025_kapibala_mobile.png",
    "[手指比心]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/2f/2025_HandHeart_mobile.png",
    "[奶牛猫]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/ce/2025_CowCat_mobile.png",
    "[柯基]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/05/2025_Corgi_mobile.png",
    "[达咩]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/2d/2025_damie_mobile.png",
    "[药]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/69/2025_medicine_mobile.png",
    "[祈祷]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/49/2025_pray_mobile.png",
    "[加油]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/6b/201810_jiayou_mobile.png",
    "[鸡腿]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/cf/2025_chicken_mobile.png",
    "[便便]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/08/2025_feces_mobile.png",
    "[锦鲤附体]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d3/2022_cometrue_mobile.png",
    "[爱慕]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/2a/2023_adore_mobile.png",
    "[么么哒]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/a5/2025_memeda_mobile.png",
    "[流汗]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/56/2025_liuhan_mobile.png",
    "[捂嘴哭]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/b4/2025_wuzuiku_mobile.png",
    "[蛋糕]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/01/201810_dangao_mobile.png",
    "[快乐打卡]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/68/2025_Happytravels_mobile.png",
    "[假期开启]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/af/2025_Holiday_mobile.png",
    "[团圆时刻]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/fc/2025_Mid-AutumnFestival_mobile.png",
    "[好事甜圆]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/06/2025_Mooncake_mobile.png",
    "[迪迦奥特曼]":
      "https://face.t.sinajs.cn/emoji/pic/20260920180818/18_Ultraman_Tiga.png",
    "[来赴来福]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/b2/2025_getFSHgethappiness_mobile.png",
    "[园丁]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/67/2025_gardener_mobile.png",
    "[写作业]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/f5/2025_Domyhomework_mobile.png",
    "[摸鱼撸猫]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/dc/2025_MOONLITREUNION_mobile.png",
    "[顾子尧]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e3/2025_GuZiyao_mobile.png",
    "[林致]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/74/2025_LinZhi_mobile.png",
    "[乔殊]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/3e/2025_QiaoShu_mobile.png",
    "[夏予扬]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/5a/2025_XiaYuyang_mobile.png",
    "[柏闻]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/07/2025_BaiWen_mobile.png",
    "[江恪]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d0/2025_JiangKe_mobile.png",
    "[季少一]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7b/2025_JiShaoyi_mobile.png",
    "[许向安]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/25/2025_XuXiangan_mobile.png",
    "[许向宁]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7c/2025_XuXiangning_mobile.png",
    "[桃里桃气]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/20/2023_TaoLiTaoQi_mobile.png",
    "[黄鸡大笑]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/95/2025_JX3CHICKENLAUGH_mobile.png",
    "[哪吒嘟嘴]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/54/2025_innocent_mobile.png",
    "[哪吒使坏]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/1b/2025_crafty_mobile.png",
    "[毕业快乐]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/6d/2024_Happygraduation_mobile.png",
    "[有票了]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/20/2023_Igotit_mobile.png",
    "[开摆]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8c/2024_takeeasy_mobile.png",
    "[淡淡的]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/70/2024_takearest_mobile.png",
    "[微笑]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/f4/201810_hehe_mobile.png",
    "[可爱]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/78/201810_keai_mobile.png",
    "[太开心]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/a6/201810_taikaixin_mobile.png",
    "[鼓掌]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/32/201810_guzhang_mobile.png",
    "[嘻嘻]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8e/201810_xixi_mobile.png",
    "[哈哈]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/c5/201810_haha_mobile.png",
    "[笑cry]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/f1/201810_xiaoku_mobile.png",
    "[挤眼]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/dd/201810_jiyan_mobile.png",
    "[馋嘴]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e9/201810_chanzui_mobile.png",
    "[黑线]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/2e/201810_heixian_mobile.png",
    "[汗]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/4b/201810_han_mobile.png",
    "[挖鼻]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/4d/201810_wabishi_mobile.png",
    "[哼]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/5b/201810_heng_mobile.png",
    "[怒]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/90/201810_nu_mobile.png",
    "[委屈]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8b/201810_weiqu_mobile.png",
    "[可怜]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/44/201810_kelian_mobile.png",
    "[失望]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/3d/201810_shiwang_mobile.png",
    "[悲伤]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/49/201810_beishang_mobile.png",
    "[泪]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/87/201810_lei_mobile.png",
    "[允悲]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/65/201810_ybnew_mobile.png",
    "[苦涩]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/5f/2021_bitter_mobile.png",
    "[害羞]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/c1/201810_haixiu_mobile.png",
    "[污]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e6/201810_wu_mobile.png",
    "[爱你]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/db/201810_aini_mobile.png",
    "[亲亲]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8f/201810_qinqin_mobile.png",
    "[抱一抱]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/84/2020_hug_mobile.png",
    "[色]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/23/201810_huaxin_mobile.png",
    "[舔屏]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/da/201810_tian_mobile.png",
    "[憧憬]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/77/201810_xingxingyan_mobile.png",
    "[哇]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/79/2022_wow_mobile.png",
    "[坏笑]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/63/201810_huaixiao_mobile.png",
    "[阴险]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/a5/201810_yinxian_mobile.png",
    "[笑而不语]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/24/201810_heiheihei_mobile.png",
    "[偷笑]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/df/201810_touxiao_mobile.png",
    "[666]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/b9/2022_666_mobile.png",
    "[酷]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/af/201810_ku_mobile.png",
    "[并不简单]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/ce/201810_bingbujiandan_mobile.png",
    "[思考]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/9e/201810_sikao_mobile.png",
    "[疑问]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/09/201810_yiwen_mobile.png",
    "[费解]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/dd/201810_feijie_mobile.png",
    "[晕]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/94/201810_yun_mobile.png",
    "[衰]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0a/201810_shuai_mobile.png",
    "[骷髅]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/94/201810_kulou_mobile.png",
    "[嘘]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/35/201810_xu_mobile.png",
    "[闭嘴]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/05/201810_bizui_mobile.png",
    "[傻眼]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/9a/201810_shayan_mobile.png",
    "[感冒]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/5d/2022_cold_mobile.png",
    "[吃惊]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/00/201810_chijing_mobile.png",
    "[裂开]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/6d/202011_liekai_mobile.png",
    "[生病]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7c/201810_shengbing_mobile.png",
    "[吐]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/4f/201810_tu_mobile.png",
    "[拜拜]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8d/201810_baibai_mobile.png",
    "[鄙视]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/71/201810_bishi_mobile.png",
    "[白眼]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/a0/201810_landelini_mobile.png",
    "[左哼哼]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/a9/201810_zuohengheng_mobile.png",
    "[右哼哼]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/39/201810_youhengheng_mobile.png",
    "[抓狂]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/02/201810_zhuakuang_mobile.png",
    "[怒骂]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d4/201810_numa_mobile.png",
    "[打脸]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/c6/201810_dalian_mobile.png",
    "[努力]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0d/2022_Keepgoing_mobile.png",
    "[顶]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/80/201810_ding_mobile.png",
    "[钱]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/91/201810_qian_mobile.png",
    "[哈欠]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/1c/201810_dahaqi_mobile.png",
    "[困]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/cb/201810_kun_mobile.png",
    "[求饶]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/ec/moren_qiurao_mobile.png",
    "[睡]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/aa/201810_shuijiao_mobile.png",
    "[awsl]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8b/moren_awsl_mobile.png",
    "[吃瓜]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0b/201810_chigua_mobile.png",
    "[打call]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/2a/moren_dacall_mobile.png",
    "[彩虹屁]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/c0/2022_praise_mobile.png",
    "[送花花]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0b/2022_Flowers_mobile.png",
    "[赢牛奶]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/83/2021_yingniunai_mobile.png",
    "[开学季]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0a/2021_kaixueji_mobile.png",
    "[上课了]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d1/2022_Forclass_mobile.png",
    "[比耶]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/49/2023_yeahyeah_mobile.png",
    "[打工人]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0b/2023_earner_mobile.png",
    "[干饭人]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/3c/2022_Foodie_mobile.png",
    "[钢镚儿]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/58/2022_coin_mobile.png",
    "[老师夸夸]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7a/2023_Theteacherpraises_mobile.png",
    "[看书]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7e/2023_read_mobile.png",
    "[融化]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/03/2022_melt_mobile.png",
    "[狗粮]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/9d/2023_PDA_mobile.png",
    "[相爱]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/1c/2023_fallinlove_mobile.png",
    "[你好老师]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/a2/2023_Helloteacher_mobile.png",
    "[老师爱你]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/86/2023_Teacherlovesyou_mobile.png",
    "[揣手]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7f/2022_chuaishou_mobile.png",
    "[举手]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/3f/2022_raisehand_mobile.png",
    "[抱抱]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8b/201810_baobao_mobile.png",
    "[摊手]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/07/201810_tanshou_mobile.png",
    "[跪了]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/2f/201810_guile_mobile.png",
    "[老师好]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/dd/2022_Teacher_mobile.png",
    "[收到]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/19/2022_get_mobile.png",
    "[上岸]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/fe/2022_Getin_mobile.png",
    "[你好]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/8e/2023_hello_mobile.png",
    "[我来了]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/4d/2023_herewego_mobile.png",
    "[我走了]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/16/2023_seeyou_mobile.png",
    "[春游家族]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d5/2021_YoungFamily_mobile.png",
    "[客厅狂欢]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/86/2023_Bedazzling_mobile.png",
    "[许愿星]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/24/2022_WishingStar_mobile.png",
    "[航天员]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0d/2021_yuhangyuan_mobile.png",
    "[奶瓶]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/97/2021_naiping_mobile.png",
    "[丘比特]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e7/2021_qiubite_mobile.png",
    "[单身狗]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/86/2021_alongdog_mobile.png",
    "[酸]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/86/hot_wosuanle_mobile.png",
    "[二哈]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/4a/2018_erha_mobile.png",
    "[喵喵]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/4b/201810_miao_mobile.png",
    "[doge]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e6/2018_doge_mobile.png",
    "[雪糕]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e6/2022_icecream_mobile.png",
    "[咖啡]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/de/2022_coffee_mobile.png",
    "[给你小心心]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/c8/qixi2018_xiaoxinxin_mobile.png",
    "[雪花]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/62/yunying2020_snowflakes_mobile.png",
    "[微风]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/0e/201810_weifeng_mobile.png",
    "[中国赞]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/88/moren_zhongguozan_mobile.png",
    "[鲜花]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/c8/201810_xianhua_mobile.png",
    "[杰瑞]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/36/2021_jerry_mobile.png",
    "[汤姆]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/55/2021_tom_mobile.png",
    "[海王]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7b/2023_Aquaman_mobile.png",
    "[奥姆]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/3e/2023_Orm_mobile.png",
    "[畅游]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/5f/2023_Swim_mobile.png",
    "[吹风车]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/27/2023_Windmill_mobile.png",
    "[流浪地球2]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e7/2023_TheWanderingEarthⅡ_mobile.png",
    "[点亮平安灯]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/97/feiyan_dianliangpingan_mobile.png",
    "[绿丝带]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/23/201810_lvsidai_mobile.png",
    "[蜡烛]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/7f/201810_lazhu_mobile.png",
    "[白蜡烛]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/a9/2022_whitecandle_mobile.png",
    "[来抱抱]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/d9/2024_Comeandhug_mobile.png",
    "[月亮]":
      "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e1/201810_yueliang_mobile.png",
  };
  async fetch(ctx) {
    try {
      const uid = String(ctx.params.uid || "");
      if (!/^\d+$/.test(uid)) {
        return Result.Err("uid 必须为数字", "INVALID_PARAMETER");
      }
      const link = "https://weibo.com/u/" + uid;
      let items = [];
      let page_error = "";
      try {
        const result_1 = await WeiboRSS.request_text(ctx, link, {
          headers: WeiboRSS.request_headers(link),
        });
        if (result_1.error) throw result_1.error;
        const html = result_1.data;
        ctx.log("微博主页获取完成", {
          length: html.length,
        });
        const result_2 = WeiboRSS.parse_feeds(html, uid);
        if (result_2.error) throw result_2.error;
        items = result_2.data;
      } catch (failure) {
        page_error =
          failure?.name === "FeedError"
            ? failure.message
            : "主页请求或解析失败";
        ctx.log("微博主页请求失败，尝试列表接口：", page_error);
      }
      if (!items.length) {
        try {
          const result_3 = await WeiboRSS.request_text(
            ctx,
            "https://weibo.com/ajax/statuses/mymblog?uid=" +
              uid +
              "&page=1&feature=0",
            {
              headers: WeiboRSS.request_headers(link, true),
            },
          );
          if (result_3.error) throw result_3.error;
          const text = result_3.data;
          let data;
          try {
            const result_4 = parseJSON(text);
            if (result_4.error) throw result_4.error;
            data = result_4.data;
          } catch {
            throw Object.assign(
              new Error(
                "微博列表接口返回非 JSON 内容，可能跳转到登录或验证页面",
              ),
              {
                name: "FeedError",
                code: "UPSTREAM_INVALID_RESPONSE",
              },
            );
          }
          if (!data || typeof data !== "object") {
            throw Object.assign(new Error("微博列表接口缺少 JSON 对象"), {
              name: "FeedError",
              code: "UPSTREAM_INVALID_RESPONSE",
            });
          }
          if (data.ok === -100) {
            return Result.Err(
              "微博列表接口要求重新登录（ok: -100），请在 Cookie 管理中同步有效的 weibo.com 登录 Cookie",
              "UPSTREAM_AUTH_REQUIRED",
            );
          }
          if (data.ok === 0 || data.ok === false) {
            throw Object.assign(
              new Error(
                "微博列表接口拒绝访问，请检查登录状态、账号权限或上游验证",
              ),
              {
                name: "FeedError",
                code: "UPSTREAM_ACCESS_DENIED",
              },
            );
          }
          if (
            data.ok === 1 &&
            Array.isArray(data.data?.list) &&
            data.data.list.length === 0
          ) {
            const result_5 = await WeiboRSS.fetch_profile(ctx, uid, link);
            if (result_5.error) throw result_5.error;
            const result_6 = WeiboRSS.build_channel(
              ctx,
              uid,
              link,
              [],
              result_5.data,
            );
            if (result_6.error) throw result_6.error;
            return Result.Ok(result_6.data);
          }
          const result_7 = WeiboRSS.parse_feeds(
            '<script type="application/json">' +
              JSON.stringify(data).replace(/</g, "\\u003c") +
              "</script>",
            uid,
          );
          if (result_7.error) throw result_7.error;
          items = result_7.data;
        } catch (failure) {
          return Result.Err(
            "微博列表读取失败：" +
              (failure?.message || "请求或响应解析失败") +
              (page_error ? "；主页：" + page_error : "") +
              "。请在 Cookie 管理中同步有效的 weibo.com 登录 Cookie；若仍返回 403，可能需要验证或上游限制了服务端请求。",
            failure?.code ?? "UPSTREAM_INVALID_RESPONSE",
          );
        }
      }
      if (!items.length) {
        return Result.Err(
          "微博 HTML 不含列表，请检查 Cookie 是否有效；页面与列表接口均未返回微博",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      await WeiboRSS.resolve_references(ctx, items, link);
      const result_8 = await WeiboRSS.fetch_profile(ctx, uid, link);
      if (result_8.error) return result_8;
      const result_9 = WeiboRSS.build_channel(
        ctx,
        uid,
        link,
        items,
        result_8.data,
      );
      if (result_9.error) return result_9;
      return Result.Ok(result_9.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async fetch_profile(ctx, uid, link) {
    try {
      try {
        const result_10 = await WeiboRSS.request_text(
          ctx,
          "https://weibo.com/ajax/profile/info?uid=" + uid + "&scene=profile",
          {
            timeout_ms: 3000,
            headers: {
              ...WeiboRSS.request_headers(link + "?lpage=profileRecom", true),
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
              "sec-ch-ua":
                '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
              "client-version": "v1.1.251",
              "server-version": "v2026.10.12.1",
              priority: "u=1, i",
            },
            cookie_headers: {
              "x-xsrf-token": "XSRF-TOKEN",
            },
          },
        );
        if (result_10.error) throw result_10.error;
        const text = result_10.data;
        const result_11 = parseJSON(text);
        if (result_11.error) throw result_11.error;
        const data = result_11.data;
        const user = data?.data?.user;
        if (
          data?.ok !== 1 ||
          !user ||
          typeof user.screen_name !== "string" ||
          !user.screen_name.trim()
        ) {
          return Result.Ok(null);
        }
        const result_12 = WeiboRSS.proxy_image(
          ctx,
          user.avatar_hd || user.avatar_large || user.profile_image_url,
        );
        if (result_12.error) throw result_12.error;
        return Result.Ok({
          name: user.screen_name.trim(),
          description:
            typeof user.description === "string" ? user.description.trim() : "",
          image: result_12.data,
        });
      } catch {
        return Result.Ok(null);
      }
      return Result.Ok(undefined);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static proxy_img(ctx) {
    return {
      url: WeiboRSS.display_image_url(ctx.query.url),
      headers: {
        Referer: "https://weibo.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
        // 只协商宿主已支持的图片格式，避免 AVIF/JXL/SVG 导致代理拒绝响应。
        Accept:
          "image/webp,image/png,image/jpeg,image/gif,image/x-icon;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Priority: "i",
        "sec-ch-ua":
          '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
        "sec-fetch-storage-access": "active",
      },
    };
  }
  static public_url(value) {
    const url = String(value || "").replace(/^\/\//, "https://");
    return /^https?:\/\//i.test(url) ? url : "";
  }
  static display_image_url(value) {
    return String(value || "").replace(
      /^(https?:\/\/(?:wx|ww)[1-4]\.sinaimg\.cn(?::443)?)\/large\//i,
      "$1/orj360/",
    );
  }
  static proxy_image(ctx, value) {
    try {
      const url = WeiboRSS.display_image_url(WeiboRSS.public_url(value));
      const host = url.match(/^https?:\/\/([^/:?#]+)(?::443)?\//i)?.[1];
      if (!host || !WeiboRSS.image_hosts.includes(host.toLowerCase())) {
        return Result.Ok(url);
      }
      if (!ctx.public_origin) {
        return Result.Err(
          "微博图片代理需要配置 FINDRSS_HOSTNAME",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      return Result.Ok(
        ctx.public_origin +
          "/img/weibo?url=" +
          encodeURIComponent(url.replace(/^http:/i, "https:")),
      );
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static html_image(tag) {
    const attributes = {};
    for (const match of tag.matchAll(
      /\s(data-src|src|alt|title)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    )) {
      attributes[match[1].toLowerCase()] = utils.decode_html(
        match[2] || match[3] || match[4],
      );
    }
    return {
      url: WeiboRSS.public_url(attributes["data-src"] || attributes.src),
      alt: attributes.alt || attributes.title || "",
    };
  }
  static is_emoji(image) {
    return (
      /^https?:\/\/face\.t\.sinajs\.cn(?::443)?\//i.test(image.url) &&
      /^\[[^\[\]\r\n]{1,32}\]$/.test(image.alt)
    );
  }
  static render_text(text, ...html_sources) {
    const emojis = {
      ...WeiboRSS.weibo_emojis,
    };
    for (const html of html_sources) {
      for (const [tag] of String(html || "").matchAll(/<img\b[^>]*>/gi)) {
        const image = WeiboRSS.html_image(tag);
        if (WeiboRSS.is_emoji(image)) {
          emojis[image.alt] = image.url;
        }
      }
    }
    return String(text || "")
      .split(/(\[[^\[\]\r\n]{1,32}\])/g)
      .map(function (part) {
        return emojis[part]
          ? '<img data-n="weibo-emoji" alt="' +
              utils.escape_html(part) +
              '" src="' +
              utils.escape_html(emojis[part]) +
              '" width="20" height="20" style="vertical-align:middle">'
          : utils.escape_html(part).replace(/\n/g, "<br>");
      })
      .join("");
  }
  static status_text(status) {
    if (!status) return "";
    const long_text = status.longText?.longTextContent;
    return (
      (long_text &&
        (/<[^>]+>/.test(long_text)
          ? utils.plain_text(long_text)
          : long_text)) ||
      status.text_raw ||
      utils.plain_text(status.text)
    );
  }
  static status_images(status) {
    const pics = status.pics
      ? Object.values(status.pics)
      : (status.pic_ids || []).map(function (id) {
          return status.pic_infos?.[id];
        });
    return [
      ...pics,
      ...(status.mix_media_info?.items || [])
        .filter(function (item) {
          return item.type === "pic";
        })
        .map(function (item) {
          return item.data;
        }),
    ]
      .map(function (pic) {
        return WeiboRSS.public_url(
          pic?.largest?.url ||
            pic?.large?.url ||
            pic?.original?.url ||
            pic?.url,
        );
      })
      .filter(Boolean);
  }
  static valid_id(value) {
    return (
      /^\d{1,24}$/.test(String(value || "")) &&
      (typeof value !== "number" || Number.isSafeInteger(value))
    );
  }
  static status_unavailable(status) {
    return (
      [true, 1, "1"].includes(status?.deleted) ||
      [7, "7"].includes(status?.state)
    );
  }
  static has_status_content(status) {
    return (
      !!status &&
      (typeof status.text_raw === "string" ||
        typeof status.text === "string" ||
        typeof status.longText?.longTextContent === "string" ||
        WeiboRSS.status_images(status).length > 0 ||
        status.page_info?.type === "video" ||
        status.page_info?.object_type === "video")
    );
  }
  static parse_feed(status, uid, ancestors = []) {
    const raw_id = status.idstr || status.id;
    if (!WeiboRSS.valid_id(raw_id)) return null;
    const id = String(raw_id);
    const text = WeiboRSS.status_text(status);
    const images = [...new Set(WeiboRSS.status_images(status))];
    const page =
      status.page_info?.object_id &&
      status.page_info.object_id ===
        status.retweeted_status?.page_info?.object_id
        ? undefined
        : status.page_info;
    const media = page?.media_info || {};
    const urls = page?.urls || {};
    const video =
      page?.type === "video" || page?.object_type === "video"
        ? WeiboRSS.public_url(
            urls.mp4_720p_mp4 ||
              urls.mp4_hd_mp4 ||
              media.stream_url_hd ||
              media.mp4_hd_url ||
              media.stream_url ||
              media.mp4_sd_url,
          )
        : "";
    const author_id = status.user?.idstr || status.user?.id || uid;
    const references = [];
    const add = (relation, original, target_id) => {
      target_id = original?.idstr || original?.id || target_id;
      if (!WeiboRSS.valid_id(target_id) || String(target_id) === id) return;
      const original_uid = original?.user?.idstr || original?.user?.id;
      const unavailable = WeiboRSS.status_unavailable(original);
      const child =
        !unavailable &&
        WeiboRSS.has_status_content(original) &&
        ancestors.length < 4 &&
        !ancestors.includes(String(target_id))
          ? WeiboRSS.parse_feed(original, original_uid, [...ancestors, id])
          : null;
      references.push({
        relation,
        id: String(target_id),
        link: child?.link || "https://weibo.com/detail/" + target_id,
        ...(child ? { item: child } : {}),
        ...(unavailable ? { unavailable: true } : {}),
      });
    };
    const repost_id =
      status.retweeted_status?.idstr ||
      status.retweeted_status?.id ||
      status.retweeted_status_idstr ||
      status.retweeted_status_id_str ||
      status.retweeted_status_id;
    const parent_id = String(status.analysis_extra || "").match(
      /(?:^|\|)mblog_parent_id:(\d+)(?:\||$)/,
    )?.[1];
    if (parent_id && parent_id !== "0" && parent_id !== String(repost_id))
      add("repost", null, parent_id);
    add("repost", status.retweeted_status, repost_id);
    add(
      "reply",
      status.in_reply_to_status || status.reply_to_status,
      status.in_reply_to_status_idstr ||
        status.in_reply_to_status_id_str ||
        status.in_reply_to_status_id ||
        status.reply_to_status_idstr ||
        status.reply_to_status_id_str ||
        status.reply_to_status_id,
    );
    add(
      "quote",
      status.quoted_status,
      status.quoted_status_idstr ||
        status.quoted_status_id_str ||
        status.quoted_status_id,
    );
    return {
      id,
      kind: references.some((ref) => ref.relation === "repost")
        ? "repost"
        : references.some((ref) => ref.relation === "reply")
          ? "reply"
          : references.length
            ? "quote"
            : "post",
      title:
        Array.from(text || "")
          .slice(0, 100)
          .join("") || "微博 " + id,
      description: text,
      content:
        "<p>" +
        WeiboRSS.render_text(
          text,
          status.text,
          status.longText?.longTextContent,
        ) +
        "</p>",
      link: author_id
        ? "https://weibo.com/" +
          author_id +
          "/" +
          (status.mblogid || status.bid || id)
        : "https://weibo.com/detail/" + id,
      author: status.user?.screen_name || "",
      published: status.created_at,
      image:
        images[0] ||
        WeiboRSS.public_url(
          typeof page?.page_pic === "string"
            ? page.page_pic
            : page?.page_pic?.url,
        ) ||
        undefined,
      images,
      ...(video ? { enclosure: { url: video, type: "video/mp4" } } : {}),
      ...(references.length ? { references } : {}),
    };
  }
  static async resolve_references(ctx, items, link) {
    const known = new Map(items.map((item) => [item.id, item]));
    const unavailable = new Set();
    const remember = (item) => {
      for (const reference of item.references || []) {
        if (reference.unavailable) unavailable.add(reference.id);
        if (reference.item && !known.has(reference.item.id)) {
          known.set(reference.item.id, reference.item);
          remember(reference.item);
        }
      }
    };
    for (const item of items) remember(item);
    let remaining = 8;
    const resolve = async (item, path = []) => {
      if (path.length >= 4) return;
      for (const reference of item.references || []) {
        if (path.includes(reference.id) || reference.id === item.id) continue;
        if (!reference.item && !reference.unavailable) {
          if (
            WeiboRSS.valid_id(reference.id) &&
            !known.has(reference.id) &&
            !unavailable.has(reference.id) &&
            remaining > 0
          ) {
            remaining--;
            known.set(reference.id, null);
            const result = await WeiboRSS.request_text(
              ctx,
              "https://weibo.com/ajax/statuses/show?id=" + reference.id,
              {
                headers: WeiboRSS.request_headers(link, true),
                cookie_headers: { "x-xsrf-token": "XSRF-TOKEN" },
                timeout_ms: 3000,
              },
            );
            if (!result.error) {
              const parsed = parseJSON(result.data);
              if (!parsed.error) {
                const status = parsed.data?.data || parsed.data;
                if (String(status?.idstr || status?.id) === reference.id) {
                  if (WeiboRSS.status_unavailable(status))
                    unavailable.add(reference.id);
                  else if (WeiboRSS.has_status_content(status)) {
                    const original = WeiboRSS.parse_feed(status);
                    known.set(reference.id, original);
                    if (original) remember(original);
                  }
                }
              }
            }
          }
          if (unavailable.has(reference.id)) {
            reference.unavailable = true;
            continue;
          }
          const original = known.get(reference.id);
          // 拷贝引用子树，避免共享列表对象形成循环或重复改写媒体。
          if (original) {
            const clone = parseJSON(JSON.stringify(original));
            if (!clone.error) {
              reference.item = clone.data;
              reference.link = clone.data.link;
            }
          }
        }
        if (reference.item) await resolve(reference.item, [...path, item.id]);
      }
      const repost = item.references?.find(
        (reference) => reference.relation === "repost",
      );
      if (repost?.item) {
        const marker = repost.item.author
          ? "//@" + repost.item.author + ":"
          : "";
        const offset = marker ? item.description.indexOf(marker) : -1;
        if (offset >= 0 && offset === item.description.indexOf("//@")) {
          const text = item.description.slice(0, offset).trim();
          item.description = text;
          item.title =
            Array.from(text).slice(0, 100).join("") || "微博 " + item.id;
          item.content =
            "<p>" + WeiboRSS.render_text(text, item.content) + "</p>";
        }
      }
    };
    for (const item of items) await resolve(item);
  }
  static parse_feeds(html, uid) {
    try {
      const items = [];
      const seen = {};
      const add = function (item) {
        if (item?.id && !seen[item.id]) {
          seen[item.id] = true;
          items.push(item);
        }
      };
      const walk = function (value) {
        if (!value || typeof value !== "object") {
          return undefined;
        }
        if (
          (value.idstr || value.id) &&
          (typeof value.text_raw === "string" ||
            typeof value.text === "string") &&
          value.user
        ) {
          add(WeiboRSS.parse_feed(value, uid));
          return undefined;
        }
        for (const key of Object.keys(value)) {
          walk(value[key]);
        }
      };
      for (const match of html.matchAll(
        /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
      )) {
        try {
          const result_13 = parseJSON(match[1]);
          if (result_13.error) throw result_13.error;
          walk(result_13.data);
        } catch {}
      }
      let fragments = html;
      for (const match of html.matchAll(/FM\.view\((\{[^\n]*?\})\)\s*;?/g)) {
        try {
          const result_14 = parseJSON(match[1]);
          if (result_14.error) throw result_14.error;
          fragments += "\n" + (result_14.data.html || "");
        } catch {}
      }
      const cards = fragments.split(
        /<div\b[^>]*\baction-type=["']feed_list_item["'][^>]*\bmid=["'](\d+)["'][^>]*>/i,
      );
      for (let index = 1; index < cards.length; index += 2) {
        const id = cards[index];
        const card = cards[index + 1];
        const text = card.match(
          /<div\b[^>]*\bnode-type=["']feed_list_content["'][^>]*>([\s\S]*?)<\/div>/i,
        )?.[1];
        if (!text) {
          continue;
        }
        const parsed_card = utils.document_nodes(card);
        if (parsed_card.error) throw parsed_card.error;
        const root = parsed_card.data;
        const forward = utils.first(
          root,
          '[node-type="feed_list_forwardContent"]',
        );
        const inside_forward = (node) => {
          for (let parent = node; parent; parent = parent.parent)
            if (parent === forward) return true;
          return false;
        };
        const links = utils
          .select(root, "a[date]")
          .filter((node) =>
            /^(?:(?:https?:)?\/\/weibo\.com)?\/\d+\/[A-Za-z0-9]+$/.test(
              node.attrs.href || "",
            ),
          );
        const link = links.find((node) => !inside_forward(node));
        const absolute_link = (value) =>
          value
            ? value.startsWith("//")
              ? "https:" + value
              : value.startsWith("/")
                ? "https://weibo.com" + value
                : value
            : "";
        const description = utils.plain_text(text);
        const original_url = links.find(inside_forward)?.attrs.href;
        const original_id = card.match(/\b(?:omid|rootmid)=(\d+)/i)?.[1];
        const original_link =
          absolute_link(original_url) ||
          (original_id ? "https://weibo.com/detail/" + original_id : "");
        const original_text =
          utils.first(forward, '[node-type="feed_list_reason"]') ||
          utils.first(forward, '[node-type="feed_list_content"]');
        const node_text = (node) =>
          !node
            ? ""
            : node.tag === "img"
              ? node.attrs.alt || ""
              : node.tag === "br"
                ? "\n"
                : node.text || node.children.map(node_text).join("");
        const original_description = node_text(original_text).trim();
        const references =
          forward && (original_id || original_link)
            ? [
                {
                  relation: "repost",
                  ...(original_id ? { id: original_id } : {}),
                  link: original_link,
                  ...(original_text && original_link
                    ? {
                        item: {
                          id: original_id || original_link,
                          kind: "post",
                          title:
                            Array.from(original_description)
                              .slice(0, 100)
                              .join("") || "原微博",
                          link: original_link,
                          description: original_description,
                          content:
                            "<p>" +
                            WeiboRSS.render_text(original_description, card) +
                            "</p>",
                          author:
                            utils.attribute(
                              forward,
                              "a[nick-name]",
                              "nick-name",
                            ) || utils.field(forward, "a[usercard]"),
                          published:
                            Number(links.find(inside_forward)?.attrs.date) ||
                            undefined,
                          images: utils
                            .select(forward, "img")
                            .filter(
                              (node) =>
                                !/^\[[^\[\]]+\]$/.test(node.attrs.alt || ""),
                            )
                            .map((node) =>
                              WeiboRSS.public_url(
                                node.attrs["data-src"] || node.attrs.src,
                              ),
                            )
                            .filter(Boolean),
                        },
                      }
                    : {}),
                },
              ]
            : [];
        add({
          id,
          kind: forward ? "repost" : "post",
          ...(references.length ? { references } : {}),
          title: Array.from(description).slice(0, 100).join("") || "微博 " + id,
          description,
          content: "<p>" + WeiboRSS.render_text(description, text) + "</p>",
          link:
            absolute_link(link?.attrs.href) ||
            "https://weibo.com/" + uid + "/" + id,
          published: link ? Number(link.attrs.date) : undefined,
          images: [],
        });
      }
      return Result.Ok(items);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static request_headers(link, ajax = false) {
    return {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      Accept: ajax
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: link,
      "sec-ch-ua":
        '\"Chromium\";v=\"154\", \"Google Chrome\";v=\"154\", \"Not A(Brand\";v=\"99\"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '\"macOS\"',
      "sec-fetch-dest": ajax ? "empty" : "document",
      "sec-fetch-mode": ajax ? "cors" : "navigate",
      "sec-fetch-site": "same-origin",
      ...(ajax
        ? {
            "X-Requested-With": "XMLHttpRequest",
          }
        : {
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            priority: "u=0, i",
          }),
    };
  }
  static build_channel(ctx, uid, link, items, profile) {
    try {
      const values_21 = items;
      const contains_item = (item, id, remaining) =>
        !!item &&
        (item.id === id ||
          (remaining > 0 &&
            (item.references || []).some((reference) =>
              contains_item(reference.item, id, remaining - 1),
            )));
      const proxy_item = function (item, depth = 0) {
        try {
          const values_16 = item.images || [];
          const result_17 = utils.map_results(values_16, function (url) {
            try {
              const result_15 = WeiboRSS.proxy_image(ctx, url);
              if (result_15.error) return result_15;
              return Result.Ok(result_15.data);
            } catch (error) {
              return Result.Err(
                error,
                error?.code ?? "UPSTREAM_INVALID_RESPONSE",
              );
            }
          });
          if (result_17.error) return result_17;
          const images = [...new Set(result_17.data)];
          const result_18 = WeiboRSS.proxy_image(ctx, item.image || images[0]);
          if (result_18.error) return result_18;
          const result_20 = utils.replace_results(
            item.content,
            /(<img\b[^>]*\bsrc=")([^"]*)/gi,
            function (_, prefix, url) {
              try {
                const result_19 = WeiboRSS.proxy_image(
                  ctx,
                  utils.decode_html(url),
                );
                if (result_19.error) return result_19;
                return Result.Ok(prefix + utils.escape_html(result_19.data));
              } catch (error) {
                return Result.Err(
                  error,
                  error?.code ?? "UPSTREAM_INVALID_RESPONSE",
                );
              }
            },
          );
          if (result_20.error) return result_20;
          const references = utils.map_results(
            item.references || [],
            function (reference) {
              if (!reference.item) return Result.Ok(reference);
              const child = proxy_item(reference.item, depth + 1);
              return child.error
                ? child
                : Result.Ok({ ...reference, item: child.data });
            },
          );
          if (references.error) return references;
          const repost = references.data.find(
            (reference) => reference.relation === "repost",
          );
          // 仅在最终四层输出范围内去重，避免深层截断后丢失根帖正文。
          const visible_references = repost?.item
            ? references.data.filter(
                (reference) =>
                  reference === repost ||
                  reference.relation !== "repost" ||
                  !contains_item(repost.item, reference.id, 4 - depth - 1),
              )
            : references.data;
          return Result.Ok({
            ...item,
            ...(visible_references.length
              ? { references: visible_references }
              : {}),
            image: result_18.data || undefined,
            images,
            content:
              result_20.data +
              images
                .map(function (url) {
                  return (
                    '<p data-n="weibo-image-block"><img data-n="weibo-image" alt="微博图片" src="' +
                    utils.escape_html(url) +
                    '"></p>'
                  );
                })
                .join(""),
          });
        } catch (error) {
          return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
        }
      };
      const result_22 = utils.map_results(values_21, (item) =>
        proxy_item(item),
      );
      if (result_22.error) return result_22;
      items = result_22.data;
      const name = profile?.name || items[0]?.author || "微博 · " + uid;
      return Result.Ok({
        id: "weibo:channel:" + uid,
        title: profile || items.length ? name + " 的微博" : "微博 · " + uid,
        link,
        description: profile?.description || "微博用户 " + name + " 的动态",
        language: "zh-cn",
        author: {
          name,
          uri: link,
        },
        image:
          profile?.image || (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://weibo.com/",
          },
          tags: ["微博"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async request_text(ctx, url, options = {}) {
    const permission = permissions.cookies.find((entry) =>
      String(url).startsWith(entry.origin + "/"),
    );
    if (permission) {
      const acquired = await ctx.cookies.get(permission.id);
      if (acquired.error) return acquired;
      return utils.request_text(ctx, url, {
        ...options,
        cookies: acquired.data,
      });
    }
    return utils.request_text(ctx, url, options);
  }
}
const script = new WeiboRSS();
export const routes = [
  {
    path: "/weibo/u/:uid",
    name: "微博用户列表",
    url: "weibo.com",
    maintainers: ["findrss"],
    example: "/weibo/u/1992429663",
    parameters: {
      uid: "微博用户 UID，例如 1992429663",
    },
    description:
      "使用域名匹配的登录 Cookie 获取用户主页微博列表，解析 HTML；新版应用壳回退到同域列表接口。",
    handler: (ctx) => script.run(ctx),
  },
  {
    public: true,
    path: "/img/weibo",
    name: "微博图片代理",
    allowed_hosts: [
      "wx1.sinaimg.cn",
      "wx2.sinaimg.cn",
      "wx3.sinaimg.cn",
      "wx4.sinaimg.cn",
      "ww1.sinaimg.cn",
      "ww2.sinaimg.cn",
      "ww3.sinaimg.cn",
      "ww4.sinaimg.cn",
      "tva1.sinaimg.cn",
      "tva2.sinaimg.cn",
      "tva3.sinaimg.cn",
      "tva4.sinaimg.cn",
      "tvax1.sinaimg.cn",
      "tvax2.sinaimg.cn",
      "tvax3.sinaimg.cn",
      "tvax4.sinaimg.cn",
      "face.t.sinajs.cn",
    ],
    example:
      "/img/weibo?url=https%3A%2F%2Fwx1.sinaimg.cn%2Flarge%2Fexample.jpg",
    parameters: {
      url: "微博图片 CDN 的完整 HTTPS 地址",
    },
    description: "",
    handler: (ctx) => WeiboRSS.proxy_img(ctx),
  },
];
