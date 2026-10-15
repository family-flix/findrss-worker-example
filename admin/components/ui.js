import "../store.js";
import "./icons/index.js";
import { AIPreferencesView } from "../pages/settings.ai.component.js";
import { XiaoxunDialogueView } from "./xiaoxun-dialogue.js";
import { XiaoxunComposerModel } from "../domain/reading/xiaoxun_composer.js";
import { AIProviderLogoModel } from "../domain/preferences/ai_provider_logo.js";
import { ensure_ai_presets, add_ai_preset, ai_provider_preset } from "../domain/preferences/ai_presets.js";
import { Button as ReaderButton } from "./frui/button.js";
import { Input as ReaderInput } from "./frui/input.js";
import { Textarea } from "./frui/textarea.js";
import { CodeEditor } from "./code_editor.js";
import { FeedAddressEditor } from "./feed_address_editor.js";
import { Select as ReaderSelect } from "./frui/select.js";
import { Checkbox } from "./frui/checkbox.js";
import { FilePicker } from "./frui/file-picker.js";
import { Card } from "./frui/card.js";
import { Badge } from "./frui/badge.js";
import { Field } from "./frui/field.js";
import { TableField } from "./frui/table-field.js";
import { PageHeader } from "./frui/page-header.js";
import { Dialog } from "./frui/dialog.js";
import { Tabs } from "./frui/tabs.js";
import { CopyButton } from "./frui/copy-button.js";
import { Switch } from "./frui/switch.js";
import { Tooltip, TooltipHost } from "./frui/tooltip.js";
import { DropdownMenu, DropdownMenuItem } from "./frui/dropdown-menu.js";
import { configure_frui } from "./frui/platform.js";

configure_frui({
  floating_style: { "z-index": "10003" },
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  get_computed_style: element => window.getComputedStyle(element),
  request_frame: callback => window.requestAnimationFrame(callback),
  set_timeout: (callback, delay) => window.setTimeout(callback, delay),
  clear_timeout: id => window.clearTimeout(id),
  listen_document: (name, callback) => {
    document.addEventListener(name, callback);
    return () => document.removeEventListener(name, callback);
  },
});

const action_icons = [
  ["delete", "trash"], ["remove", "trash"], ["revoke", "circle-x"], ["logout", "log-out"],
  ["login", "log-in"], ["save", "save"], ["submit", "save"], ["create", "plus"], ["add", "plus"], ["new", "plus"],
  ["refresh", "refresh-cw"], ["reconnect", "refresh-cw"], ["search", "search"], ["copy", "copy"],
  ["edit", "pen-line"], ["cancel", "x"], ["close", "x"], ["test", "play"], ["start", "play"],
  ["stop", "square"], ["logs", "scroll-text"], ["export", "download"], ["download", "download"],
  ["preview", "eye"], ["template", "file-code"], ["reset", "rotate-ccw"], ["toggle", "settings"],
  ["token", "lock"], ["read", "check"],
];

function Icon(name, size = 18) {
  if (name?.__is_ref) {
    return Timeless.For({ each: Timeless.computed(name, name => [{ name }]), key: "name",
      render: value => Icon(value?.__is_ref ? value.value.name : value.name, size) });
  }
  return Timeless.View({ class: "box-border inline-flex flex-none items-center justify-center", attributes: { n: "admin-icon-" + name, "aria-hidden": "true" } }, [Timeless.Icon({ name, size })]);
}

function Button(props = {}, children = []) {
  const name = props.attributes?.n || "";
  const action = action_icons.find(([action]) => name.split("-").includes(action));
  const variant = props.variant || (action?.[0] === "delete" || action?.[0] === "remove" ? "danger" : "default");
  return ReaderButton({ ...props, variant, icon: props.icon ?? (action ? Icon(action[1], 16) : undefined) }, children);
}

// 保留后台原有事件形状；业务状态和提交仍由各页 Model 维护。
function Input(props = {}) {
  if (props.attributes?.type === "checkbox") {
    const { type, checked, ...attributes } = props.attributes;
    return Checkbox({ ...props, attributes, checked,
      onChange: checked => props.onChange?.({ target: { checked } }) });
  }
  return ReaderInput(props);
}

function Select(props = {}) {
  return ReaderSelect({ ...props, onChange: value => props.onChange?.({ target: { value } }) });
}

window.FindRSSAdminUI = { ...Timeless, AIPreferencesView, XiaoxunDialogueView, XiaoxunComposerModel, AIProviderLogoModel, ensure_ai_presets, add_ai_preset, ai_provider_preset, Button, Input, Select, Textarea, CodeEditor, FeedAddressEditor, FilePicker, Card, Badge, Field, TableField, PageHeader, Dialog, Tabs, CopyButton, Switch, Tooltip, TooltipHost, DropdownMenu, DropdownMenuItem, Icon };
