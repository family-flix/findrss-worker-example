// 浏览器组合根注入；组件不直接访问宿主全局。
const frui_host = {};

function configure_frui(host) {
  Object.assign(frui_host, host);
}
export {
  frui_host,
  configure_frui
};
