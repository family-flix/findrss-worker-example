/** RSS */
import { utils } from '@findrss/util';
export const permissions = {
  "cookies": [{
    "id": "account_0",
    "origin": "https://x.com",
    "path_prefix": "/",
    "names": ["auth_token", "ct0", "twid", "guest_id", "kdt"],
    "purpose": "读取用户授权的 X 用户作品 页面或接口"
  }, {
    "id": "account_1",
    "origin": "https://www.x.com",
    "path_prefix": "/",
    "names": ["auth_token", "ct0", "twid", "guest_id", "kdt"],
    "purpose": "读取用户授权的 X 用户作品 页面或接口"
  }]
};
export class XUserRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const username = String((ctx.params?.username || "")).replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
        return Result.Err("username 无效", "INVALID_PARAMETER");
      }
      const link = "https://x.com/" + username;
      const headers = {
        Accept: "*/*",
        Referer: link,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      };
      const result_1 = await XUserRSS.request_text(ctx, link, {
        headers
      });
      if (result_1.error) return result_1;
      const html = result_1.data;
      const script_url = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[A-Za-z0-9_-]+\.js/)?.[0];
      if (!script_url) {
        return Result.Err("X 主页缺少客户端脚本，请检查登录 Cookie", 'UPSTREAM_INVALID_RESPONSE');
      }
      const result_2 = await XUserRSS.request_text(ctx, script_url, {
        headers
      });
      if (result_2.error) return result_2;
      const script = result_2.data;
      let result;
      let profile;
      let user_id;
      try {
        const result_3 = await XUserRSS.fetch_operation(ctx, script, "UserByScreenName", {
          screen_name: username,
          withSafetyModeUserFields: true
        }, headers, {
          withAuxiliaryUserLabels: false
        });
        if (result_3.error) throw result_3.error;
        const lookup = result_3.data;
        profile = lookup.data?.user?.result;
        user_id = String((profile?.rest_id || ""));
        if (((lookup.errors || !/^\d{1,24}$/.test(user_id)) || (typeof profile?.rest_id === "number" && !Number.isSafeInteger(profile.rest_id)))) {
          throw Object.assign(new Error("X 用户查询失败或缺少有效数字 ID，请检查用户名、账号权限与上游验证"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
        const result_4 = await XUserRSS.fetch_operation(ctx, script, "UserTweets", {
          userId: user_id,
          count: 20,
          includePromotedContent: false,
          withQuickPromoteEligibilityTweetFields: true,
          withVoice: true,
        }, headers, {
          withArticlePlainText: false
        });
        if (result_4.error) throw result_4.error;
        result = result_4.data;
        const timeline = (result.data?.user?.result?.timeline_v2 || result.data?.user?.result?.timeline);
        if ((result.errors || !Array.isArray(timeline?.timeline?.instructions))) {
          throw Object.assign(new Error("X 接口拒绝请求或缺少 timeline.instructions，请检查账号权限与上游验证"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
      } catch (error) {
        return Result.Err("X 作品读取失败：" + ((error.message || "请求或响应解析失败")) + "；请同步有效的 auth_token 与 ct0 Cookie", error.code ?? "UPSTREAM_INVALID_RESPONSE");
      }
      const account = {
        ...profile,
        ...result.data.user.result
      };
      const legacy = (account.legacy || {});
      const name = String(((legacy.name || account.core?.name) || username));
      const tweets = [];
      const items = [];
      const seen = new Set();
      XUserRSS.timeline_tweets(((account.timeline_v2 || account.timeline)).timeline.instructions, tweets);
      for (const tweet of tweets) {
        const id = String(tweet.rest_id);
        const post = tweet.legacy;
        if ((!/^\d+$/.test(id) || (typeof tweet.rest_id === "number" && !Number.isSafeInteger(tweet.rest_id)))) {
          return Result.Err("X 作品缺少有效 ID", 'UPSTREAM_INVALID_RESPONSE');
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const description = String(((tweet.note_tweet?.note_tweet_results?.result?.text || post.full_text) || ""));
        const media = (post.extended_entities?.media || []);
        const images = media.filter(function(item) {
          return item.type === "photo";
        }).map(function(item) {
          return XUserRSS.public_url(item.media_url_https);
        }).filter(Boolean);
        const variants = media.flatMap(function(item) {
          return (item.video_info?.variants || []);
        }).filter(function(item) {
          return (item.content_type === "video/mp4" && XUserRSS.public_url(item.url));
        }).sort(function(a, b) {
          return ((b.bitrate || 0)) - ((a.bitrate || 0));
        });
        const published = Date.parse(post.created_at);
        items.push({
          id: "x:tweet:" + id,
          title: (description.split("\n")[0] || "X 作品 " + id),
          link: link + "/status/" + id,
          description,
          author: {
            name,
            uri: link
          },
          image: (XUserRSS.public_url(media[0]?.media_url_https) || undefined),
          ...((images.length ? {
            images
          } : {})),
          ...((Number.isFinite(published) ? {
            published
          } : {})),
          ...((variants.length ? {
            enclosure: {
              url: variants[0].url,
              type: "video/mp4"
            }
          } : {})),
        });
      }
      items.sort(function(a, b) {
        return ((b.published || 0)) - ((a.published || 0));
      });
      return Result.Ok({
        id: "x:user:" + user_id,
        title: name + " 的 X 作品",
        link,
        description: String((legacy.description || "")),
        language: "",
        author: {
          name,
          uri: link
        },
        image: (XUserRSS.public_url((legacy.profile_image_url_https || account.avatar?.image_url)) || ((ctx.public_origin || "")) + "/findrss-logo.png"),
        updated: (items[0]?.published || null),
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
  static public_url(value) {
    return (/^https:\/\//i.test(String((value || ""))) ? value : "");
  }
  static operation_info(script, operation_name) {
    try {
      const match = script.match(new RegExp('queryId:"([^"]+)",operationName:"' + operation_name + '"'));
      if ((!match || !/^[A-Za-z0-9_-]+$/.test(match[1]))) {
        return Result.Err("X 客户端缺少 " + operation_name + " 定义", 'UPSTREAM_INVALID_RESPONSE');
      }
      const switches = script.slice(match.index + match[0].length, match.index + match[0].length + 20000).split('queryId:"')[0].match(/featureSwitches:\[([^\]]*)\]/);
      if (!switches) {
        return Result.Err("X 客户端缺少 " + operation_name + " featureSwitches", 'UPSTREAM_INVALID_RESPONSE');
      }
      const features = {};
      for (const name of switches[1].matchAll(/"([A-Za-z0-9_]+)"/g)) {
        features[name[1]] = ["responsive_web_graphql_timeline_navigation_enabled", "longform_notetweets_consumption_enabled", "rweb_video_screen_enabled", ].includes(name[1]);
      }
      const bearer = script.match(/AAAAA[A-Za-z0-9%_-]{60,}/)?.[0];
      if (!bearer) {
        return Result.Err("X 客户端缺少 Bearer token", 'UPSTREAM_INVALID_RESPONSE');
      }
      return Result.Ok({
        query_id: match[1],
        features,
        bearer: decodeURIComponent(bearer)
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async fetch_operation(ctx, script, operation_name, variables, headers, field_toggles) {
    try {
      const result_5 = XUserRSS.operation_info(script, operation_name);
      if (result_5.error) return result_5;
      const operation = result_5.data;
      const params = {
        variables: JSON.stringify(variables),
        features: JSON.stringify(operation.features),
        fieldToggles: JSON.stringify(field_toggles),
      };
      const query = Object.entries(params).map(function([key, value]) {
        return key + "=" + encodeURIComponent(value);
      }).join("&");
      const result_6 = await XUserRSS.request_text(ctx, "https://x.com/i/api/graphql/" + operation.query_id + "/" + operation_name + "?" + query, {
        headers: {
          ...headers,
          Authorization: "Bearer " + operation.bearer,
          "X-Twitter-Active-User": "yes",
          "X-Twitter-Auth-Type": "OAuth2Session",
          "X-Twitter-Client-Language": "en",
        },
        cookie_headers: {
          "x-csrf-token": "ct0"
        },
      });
      if (result_6.error) return result_6;
      const result_7 = parseJSON(result_6.data);
      if (result_7.error) return result_7;
      return Result.Ok(result_7.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static timeline_tweets(value, tweets) {
    if (((!value || typeof value !== "object") || String((value.entryId || "")).startsWith("promoted"))) {
      return undefined;
    }
    if (value.tweet_results) {
      let tweet = value.tweet_results.result;
      while (tweet && !tweet.legacy && tweet.tweet) {
        tweet = tweet.tweet;
      }
      if ((tweet?.legacy && tweet.rest_id)) {
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
    const permission = permissions.cookies.find(entry => String(url).startsWith(entry.origin + '/'));
    if (permission) {
      const acquired = await ctx.cookies.get(permission.id);
      if (acquired.error) return acquired;
      return utils.request_text(ctx, url, {
        ...options,
        cookies: acquired.data
      });
    }
    return utils.request_text(ctx, url, options);
  }
}
const script = new XUserRSS();
export const route = {
  "name": "X 用户作品",
  "path": "/x/user/:username",
  "url": "x.com",
  "maintainers": ["findrss"],
  "example": "/x/user/NTCGoK9jFQURsEu",
  "parameters": {
    "username": "账号主页中的用户名，@ 可省略"
  },
  "description": "按用户名自动查询数字 ID，获取 UserTweets 最新一页；需要后台同步 x.com 的 auth_token 与 ct0 Cookie。",
  handler: ctx => script.run(ctx),
};
