import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "X",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="x-platform-icon"><rect width="32" height="32" rx="8" data-n="x-icon-rect-1" /><path fill="#fff" d="M7 7h5.2l4.2 5.6L22.3 7H25l-6.4 7.4L25.1 25h-5.2l-4.8-6.4L9.7 25H7l6.5-7.7z" data-n="x-icon-path-2" /></svg>',
};

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://x.com",
      path_prefix: "/",
      names: ["auth_token", "ct0", "twid", "guest_id", "kdt"],
      purpose: "读取用户授权的 X 用户作品 页面或接口",
    },
    {
      id: "account_1",
      origin: "https://www.x.com",
      path_prefix: "/",
      names: ["auth_token", "ct0", "twid", "guest_id", "kdt"],
      purpose: "读取用户授权的 X 用户作品 页面或接口",
    },
  ],
};
export class XUserRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const username = String(ctx.params?.username || "").replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
        return Result.Err("username 无效", "INVALID_PARAMETER");
      }
      const link = "https://x.com/" + username;
      const headers = {
        Accept: "*/*",
        Referer: link,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      };
      const result_1 = await XUserRSS.request_text(ctx, link, {
        headers,
      });
      if (result_1.error) return result_1;
      const html = result_1.data;
      const embedded = XUserRSS.embedded_account(html);
      if (embedded.error) return embedded;
      let account = embedded.data;
      let client_script = "";
      if (!account) {
        const script_url = html.match(
          /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[A-Za-z0-9_-]+\.js/,
        )?.[0];
        if (!script_url) {
          return Result.Err(
            "X 主页缺少内嵌时间线和客户端脚本，可能返回了登录页或验证页，请检查 Cookie 与访问限制",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        const result_2 = await XUserRSS.request_text(ctx, script_url, {
          headers,
        });
        if (result_2.error) return result_2;
        const script = result_2.data;
        client_script = script;
        let result;
        let profile;
        let user_id;
        try {
          const result_3 = await XUserRSS.fetch_operation(
            ctx,
            script,
            "UserByScreenName",
            {
              screen_name: username,
              withSafetyModeUserFields: true,
            },
            headers,
            {
              withAuxiliaryUserLabels: false,
            },
          );
          if (result_3.error) throw result_3.error;
          const lookup = result_3.data;
          profile = lookup.data?.user?.result;
          user_id = String(profile?.rest_id || "");
          if (
            lookup.errors ||
            !/^\d{1,24}$/.test(user_id) ||
            (typeof profile?.rest_id === "number" &&
              !Number.isSafeInteger(profile.rest_id))
          ) {
            throw Object.assign(
              new Error(
                "X 用户查询失败或缺少有效数字 ID，请检查用户名、账号权限与上游验证",
              ),
              {
                name: "FeedError",
                code: "UPSTREAM_INVALID_RESPONSE",
              },
            );
          }
          const result_4 = await XUserRSS.fetch_operation(
            ctx,
            script,
            "UserTweets",
            {
              userId: user_id,
              count: 20,
              includePromotedContent: false,
              withQuickPromoteEligibilityTweetFields: true,
              withVoice: true,
            },
            headers,
            {
              withArticlePlainText: false,
            },
          );
          if (result_4.error) throw result_4.error;
          result = result_4.data;
          const timeline =
            result.data?.user?.result?.timeline_v2 ||
            result.data?.user?.result?.timeline;
          if (
            result.errors ||
            !Array.isArray(timeline?.timeline?.instructions)
          ) {
            throw Object.assign(
              new Error(
                "X 接口拒绝请求或缺少 timeline.instructions，请检查账号权限与上游验证",
              ),
              {
                name: "FeedError",
                code: "UPSTREAM_INVALID_RESPONSE",
              },
            );
          }
        } catch (error) {
          return Result.Err(
            "X 作品读取失败：" +
              (error.message || "请求或响应解析失败") +
              "；请同步有效的 auth_token 与 ct0 Cookie",
            error.code ?? "UPSTREAM_INVALID_RESPONSE",
          );
        }
        account = {
          ...profile,
          ...result.data.user.result,
        };
      }
      const user_id = String(account.rest_id);
      const legacy = account.legacy || {};
      const name = String(legacy.name || account.core?.name || username);
      const tweets = [];
      const items = [];
      const seen = new Set();
      XUserRSS.timeline_tweets(
        (account.timeline_v2 || account.timeline).timeline.instructions,
        tweets,
      );
      for (const tweet of tweets) {
        const id = String(tweet.rest_id);
        if (
          !XUserRSS.valid_id(tweet.rest_id) ||
          (typeof tweet.rest_id === "number" &&
            !Number.isSafeInteger(tweet.rest_id))
        ) {
          return Result.Err("X 作品缺少有效 ID", "UPSTREAM_INVALID_RESPONSE");
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        items.push(XUserRSS.parse_tweet(tweet, { name, username }));
      }
      const originals = new Map(tweets.map(tweet => [String(tweet.rest_id), tweet]));
      let remaining = 8;
      let client_attempted = !!client_script;
      const resolve = async (item, path = []) => {
        if (path.length >= 4) return;
        for (const reference of item.references || []) {
          if (path.includes(reference.id) || reference.id === item.id) continue;
          if (!reference.item && !reference.unavailable) {
            const target_id = reference.id.replace("x:tweet:", "");
            if (!originals.has(target_id)) {
              const embedded = XUserRSS.find_tweet(tweets, target_id);
              if (embedded) originals.set(target_id, embedded);
            }
            if (!originals.has(target_id) && remaining > 0) {
              remaining--;
              originals.set(target_id, null);
              if (!client_attempted) {
                client_attempted = true;
                const script_url = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[A-Za-z0-9_-]+\.js/)?.[0];
                if (script_url) {
                  const loaded = await XUserRSS.request_text(ctx, script_url, { headers, timeout_ms: 3000 });
                  if (!loaded.error) client_script = loaded.data;
                }
              }
              if (client_script) {
                const operation = XUserRSS.operation_info(client_script, "TweetResultByRestId");
                const result = await XUserRSS.fetch_operation(ctx, client_script,
                  operation.error ? "TweetDetail" : "TweetResultByRestId",
                  operation.error ? { focalTweetId: target_id, with_rux_injections: false, rankingMode: "Relevance", includePromotedContent: false, withCommunity: true, withVoice: true }
                    : { tweetId: target_id, withCommunity: false, includePromotedContent: false, withVoice: true },
                  headers, { withArticlePlainText: false }, 3000);
                if (!result.error) originals.set(target_id, XUserRSS.find_tweet(result.data, target_id));
              }
            }
            const original = originals.get(target_id);
            if (original && String(original.rest_id) !== item.id.replace("x:tweet:", "")) {
              reference.item = XUserRSS.parse_tweet(original);
              if (reference.item) reference.link = reference.item.link;
            }
          }
          if (reference.item) await resolve(reference.item, [...path, item.id]);
        }
      };
      for (const item of items) await resolve(item);
      items.sort(function (a, b) {
        return (b.published || 0) - (a.published || 0);
      });
      return Result.Ok({
        id: "x:user:" + user_id,
        title: name + " 的 X 作品",
        link,
        description: String(
          legacy.description || account.profile_bio?.description || "",
        ),
        language: "",
        author: {
          name,
          uri: link,
        },
        image:
          XUserRSS.public_url(
            legacy.profile_image_url_https || account.avatar?.image_url,
          ) || (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          tags: ["X"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static tweet_result(value) {
    let tweet = value?.result || value;
    while (tweet && !tweet.legacy && !tweet.details && tweet.tweet) tweet = tweet.tweet;
    return tweet;
  }
  static valid_id(value) {
    return /^\d{1,24}$/.test(String(value || "")) && (typeof value !== "number" || Number.isSafeInteger(value));
  }
  static parse_tweet(value, fallback = {}, ancestors = []) {
    const tweet = XUserRSS.tweet_result(value);
    if (!tweet || !XUserRSS.valid_id(tweet.rest_id) || (!tweet.legacy && !tweet.details)) return null;
    const id = String(tweet.rest_id);
    const post = { ...tweet.legacy, ...tweet.details };
    const user = tweet.core?.user_results?.result || {};
    const username = user.core?.screen_name || user.legacy?.screen_name || fallback.username;
    const name = user.core?.name || user.legacy?.name || fallback.name || username || "";
    const link = username ? "https://x.com/" + username : "";
    const description = String(tweet.note_tweet?.note_tweet_results?.result?.text || post.full_text || "");
    const media = tweet.media_entities2 || post.extended_entities?.media || [];
    const images = media.filter(item => item.type === "photo").map(item => XUserRSS.public_url(item.media_url_https)).filter(Boolean);
    const variants = media.flatMap(item => item.video_info?.variants || [])
      .filter(item => item.content_type === "video/mp4" && XUserRSS.public_url(item.url))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const published = tweet.details?.created_at_ms ?? Date.parse(post.created_at);
    const references = [];
    const add = (relation, value, target_id, screen_name) => {
      const original = XUserRSS.tweet_result(value);
      target_id = original?.rest_id || target_id;
      if (!XUserRSS.valid_id(target_id) || String(target_id) === id) return;
      const child = ancestors.length < 4 && !ancestors.includes(String(target_id))
        ? XUserRSS.parse_tweet(original, {}, [...ancestors, id]) : null;
      references.push({ relation, id: "x:tweet:" + target_id,
        link: child?.link || (screen_name ? "https://x.com/" + screen_name + "/status/" : "https://x.com/i/web/status/") + target_id,
        ...(child ? { item: child } : {}),
        ...(["TweetUnavailable", "TweetTombstone"].includes(original?.__typename) ? { unavailable: true } : {}),
      });
    };
    add("repost", tweet.retweeted_status_result || post.retweeted_status_result || tweet.retweeted_status || post.retweeted_status, post.retweeted_status_id_str);
    add("reply", tweet.in_reply_to_status_result || post.in_reply_to_status_result || post.in_reply_to_status,
      post.in_reply_to_status_id_str || post.in_reply_to_status_id, post.in_reply_to_screen_name);
    add("quote", tweet.quoted_status_result || post.quoted_status_result || post.quoted_status,
      post.quoted_status_id_str || post.quoted_status_id || post.quoted_status_permalink?.expanded?.match(/\/status\/(\d+)/)?.[1]);
    return {
      id: "x:tweet:" + id, kind: references.find(ref => ref.relation === "repost") ? "repost"
        : references.find(ref => ref.relation === "reply") ? "reply" : references.length ? "quote" : "post",
      title: description.split("\n")[0] || "X 作品 " + id,
      link: (link || "https://x.com/i/web") + "/status/" + id,
      description, author: { name, ...(link ? { uri: link } : {}) },
      image: XUserRSS.public_url(media[0]?.media_url_https) || undefined,
      ...(images.length ? { images } : {}), ...(Number.isFinite(published) ? { published } : {}),
      ...(variants.length ? { enclosure: { url: variants[0].url, type: "video/mp4" } } : {}),
      ...(references.length ? { references } : {}),
    };
  }
  static find_tweet(value, id) {
    if (!value || typeof value !== "object") return null;
    if (String(value.rest_id) === id && (value.legacy || value.details)) return value;
    for (const child of Object.values(value)) {
      const found = XUserRSS.find_tweet(child, id);
      if (found) return found;
    }
    return null;
  }
  static public_url(value) {
    return /^https:\/\//i.test(String(value || "")) ? value : "";
  }
  static embedded_account(html) {
    let account = null;
    for (const block of html.matchAll(
      /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      for (const match of block[1].matchAll(
        /kind:"Result\.Ok",value:("(?:\\.|[^"\\])*")/g,
      )) {
        const text = parseJSON(match[1]);
        if (text.error) return text;
        const parsed = parseJSON(text.data);
        if (parsed.error) return parsed;
        const user = parsed.data?.data?.user_result_by_screen_name?.result;
        if (user) {
          if (parsed.data.errors)
            return Result.Err(
              "X 内嵌用户数据返回错误",
              "UPSTREAM_INVALID_RESPONSE",
            );
          account = { ...account, ...user };
        }
      }
    }
    if (account) {
      account.timeline = account.profile_user_originals_timeline;
      if (
        !/^\d{1,24}$/.test(String(account.rest_id || "")) ||
        (typeof account.rest_id === "number" &&
          !Number.isSafeInteger(account.rest_id)) ||
        !Array.isArray(account.timeline?.timeline?.instructions)
      ) {
        return Result.Err(
          "X 内嵌用户数据缺少有效 ID 或时间线，请检查账号权限与上游验证",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
    }
    return Result.Ok(account);
  }
  static operation_info(script, operation_name) {
    try {
      const match = script.match(
        new RegExp('queryId:"([^"]+)",operationName:"' + operation_name + '"'),
      );
      if (!match || !/^[A-Za-z0-9_-]+$/.test(match[1])) {
        return Result.Err(
          "X 客户端缺少 " + operation_name + " 定义",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const switches = script
        .slice(
          match.index + match[0].length,
          match.index + match[0].length + 20000,
        )
        .split('queryId:"')[0]
        .match(/featureSwitches:\[([^\]]*)\]/);
      if (!switches) {
        return Result.Err(
          "X 客户端缺少 " + operation_name + " featureSwitches",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const features = {};
      for (const name of switches[1].matchAll(/"([A-Za-z0-9_]+)"/g)) {
        features[name[1]] = [
          "responsive_web_graphql_timeline_navigation_enabled",
          "longform_notetweets_consumption_enabled",
          "rweb_video_screen_enabled",
        ].includes(name[1]);
      }
      const bearer = script.match(/AAAAA[A-Za-z0-9%_-]{60,}/)?.[0];
      if (!bearer) {
        return Result.Err(
          "X 客户端缺少 Bearer token",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      return Result.Ok({
        query_id: match[1],
        features,
        bearer: decodeURIComponent(bearer),
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async fetch_operation(
    ctx,
    script,
    operation_name,
    variables,
    headers,
    field_toggles,
    timeout_ms,
  ) {
    try {
      const result_5 = XUserRSS.operation_info(script, operation_name);
      if (result_5.error) return result_5;
      const operation = result_5.data;
      const params = {
        variables: JSON.stringify(variables),
        features: JSON.stringify(operation.features),
        fieldToggles: JSON.stringify(field_toggles),
      };
      const query = Object.entries(params)
        .map(function ([key, value]) {
          return key + "=" + encodeURIComponent(value);
        })
        .join("&");
      const result_6 = await XUserRSS.request_text(
        ctx,
        "https://x.com/i/api/graphql/" +
          operation.query_id +
          "/" +
          operation_name +
          "?" +
          query,
        {
          headers: {
            ...headers,
            Authorization: "Bearer " + operation.bearer,
            "X-Twitter-Active-User": "yes",
            "X-Twitter-Auth-Type": "OAuth2Session",
            "X-Twitter-Client-Language": "en",
          },
          ...(timeout_ms ? { timeout_ms } : {}),
          cookie_headers: {
            "x-csrf-token": "ct0",
          },
        },
      );
      if (result_6.error) return result_6;
      const result_7 = parseJSON(result_6.data);
      if (result_7.error) return result_7;
      return Result.Ok(result_7.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static timeline_tweets(value, tweets) {
    if (
      !value ||
      typeof value !== "object" ||
      String(value.entryId || "").startsWith("promoted")
    ) {
      return undefined;
    }
    if (value.tweet_results) {
      let tweet = value.tweet_results.result;
      while (tweet && !tweet.legacy && !tweet.details && tweet.tweet) {
        tweet = tweet.tweet;
      }
      if ((tweet?.legacy || tweet?.details) && tweet.rest_id) {
        tweets.push(tweet);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "tweet_results") {
        XUserRSS.timeline_tweets(child, tweets);
      }
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
const script = new XUserRSS();
export const route = {
  name: "X 用户作品",
  path: "/x/:username",
  url: "x.com",
  maintainers: ["findrss"],
  example: "/x/NTCGoK9jFQURsEu",
  parameters: {
    username: "账号主页中的用户名，@ 可省略",
  },
  description:
    "按用户名读取主页内嵌作品，旧版页面回退 UserTweets；仅获取上游返回的一页，可在后台同步 x.com 的 auth_token 与 ct0 Cookie。",
  handler: (ctx) => script.run(ctx),
};
