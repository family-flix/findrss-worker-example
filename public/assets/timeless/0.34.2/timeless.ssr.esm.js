import { isElement } from "timeless";
var package_default = {
	name: "@timeless/timeless-ssr",
	version: "0.34.2",
	main: "dist/timeless.ssr.esm.js",
	types: "dist/index.d.ts",
	scripts: {
		"build": "vite build",
		"test": "vitest run",
		"test:watch": "vitest"
	},
	type: "module",
	files: ["src", "dist"],
	dependencies: {
		"@timeless/timeless": "workspace:*",
		"@timeless/inner-icons": "workspace:*"
	}
};
function buildAttributes(state) {
	const attributes = [];
	if (!state) return [];
	if (state.id !== void 0) attributes.push({
		key: "id",
		value: state.id
	});
	if (state.styleSet && state.styleSet.length > 0) {
		const r = state.styleSet.join(" ");
		if (r) attributes.push({
			key: "class",
			value: r
		});
	}
	if (state.style) {
		const v = styleToString(state.style);
		if (v) attributes.push({
			key: "style",
			value: v + ";"
		});
	}
	if (state.attributes) {
		for (const [key, value] of Object.entries(state.attributes)) if (value !== void 0 && value !== null) attributes.push({
			key,
			value: attrEscape(String(value))
		});
	}
	if (state.dataset) {
		for (const [key, value] of Object.entries(state.dataset)) if (value !== void 0 && value !== null) attributes.push({
			key: `data-${camelToKebab(key)}`,
			value: attrEscape(String(value))
		});
	}
	if (attributes.length === 0) return [];
	return attributes.map((attr) => `${attr.key}="${attr.value}"`);
}
function buildChildren(children, build) {
	if (!children) return "";
	let result = "";
	for (const child of children) if (child) {
		const child$ = build(child);
		result += child$.render();
	}
	return result;
}
function styleToString(style) {
	const parts = [];
	const keys = Object.keys(style);
	for (let i = 0; i < keys.length; i += 1) {
		const k = keys[i];
		const value = style[k];
		if (value !== void 0 && value !== null) parts.push(`${camelToKebab(k)}:${value}`);
	}
	return parts.join(";");
}
function camelToKebab(str) {
	return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}
function attrEscape(str) {
	return str.replace(/"/g, "&quot;");
}
function SSRBox() {
	return {
		buildAttributes,
		buildChildren,
		stringifyAttrs(attrs) {
			if (attrs.length === 0) return "";
			return " " + attrs.join(" ");
		},
		methods: {
			isDocumentFragment() {
				return false;
			},
			get$elm() {
				return "";
			},
			setStyle() {},
			setStyleValue() {},
			setStyleSet() {},
			setAttribute() {},
			removeAttribute() {},
			getBoundingClientRect() {
				return {
					x: 0,
					y: 0,
					width: 0,
					height: 0,
					top: 0,
					left: 0,
					right: 0,
					bottom: 0
				};
			},
			addEventListener() {
				return function() {};
			},
			removeEventListener() {},
			setupEventListener(_events) {},
			teardownEventListener(_events) {},
			get$children() {
				return [];
			},
			trackChild(_dom, _element, _vnode, _index) {},
			untrackChild(_index) {},
			getChildren() {
				return [];
			},
			buildChildren() {
				return {
					$fragment: null,
					child_nodes: [],
					child_elements: [],
					child_host_nodes: []
				};
			},
			insertChildren() {},
			removeChildren() {},
			getParent() {
				return null;
			}
		}
	};
}
function SSRView(props) {
	const t = "view";
	const box$ = SSRBox();
	return {
		...box$.methods,
		t,
		getType() {
			return "view";
		},
		render() {
			const attrs = box$.buildAttributes(props.elm.state);
			const children = box$.buildChildren(props.elm.children, props.build);
			const tag = "div";
			if ([
				"area",
				"base",
				"br",
				"col",
				"embed",
				"hr",
				"img",
				"input",
				"link",
				"meta",
				"param",
				"source",
				"track",
				"wbr"
			].includes(tag.toLowerCase())) return `<${tag}${box$.stringifyAttrs(attrs)}>`;
			return `<${tag}${box$.stringifyAttrs(attrs)}>${children}</${tag}>`;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRModal(props) {
	const box = SSRBox();
	return {
		...box.methods,
		t: "modal",
		getType() {
			return "view";
		},
		render() {
			const attrs = box.buildAttributes(props.elm.state);
			if (props.elm.state.open) attrs.push("open");
			return `<dialog${box.stringifyAttrs(attrs)}>${box.buildChildren(props.elm.children, props.build)}</dialog>`;
		},
		hydrate() {}
	};
}
function SSRCanvas(props) {
	const box = SSRBox();
	return {
		...box.methods,
		t: "canvas",
		getType() {
			return "view";
		},
		render() {
			const attrs = box.buildAttributes(props.elm.state);
			return `<canvas${box.stringifyAttrs(attrs)}>${box.buildChildren(props.elm.children, props.build)}</canvas>`;
		},
		hydrate() {}
	};
}
function SSRText(props) {
	const t = "text";
	return {
		...SSRBox().methods,
		t,
		getType() {
			return "text";
		},
		render() {
			const value = props.elm.state.value;
			if (value !== null && value !== void 0) return textEscape(String(value));
			return "";
		},
		hydrate(elm, $dom) {}
	};
}
function textEscape(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function SSRFragment(props) {
	const t = "fragment";
	return {
		...SSRBox().methods,
		t,
		getType() {
			return "fragment";
		},
		render() {
			if (!props.elm.children) return "";
			let result = "";
			for (const child of props.elm.children) if (child) {
				const child$ = props.build(child);
				result += child$.render();
			}
			return result;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRShow(props) {
	const t = "show";
	return {
		...SSRBox().methods,
		t,
		getType() {
			return "reactive";
		},
		render() {
			if (!props.elm.children) return "";
			let result = "";
			for (let i = 0; i < props.elm.children.length; i++) {
				const child = props.elm.children[i];
				if (child) {
					const child$ = props.build(child);
					result += child$.render();
				}
			}
			return result;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRMatch(props) {
	return {
		...SSRBox().methods,
		t: "match",
		getType() {
			return "reactive";
		},
		isDocumentFragment() {
			return true;
		},
		render() {
			if (!props.elm.children) return "";
			let result = "";
			for (const child of props.elm.children) if (child) {
				const child$ = props.build(child);
				result += child$.render();
			}
			return result;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRFor(props) {
	return {
		...SSRBox().methods,
		t: "for",
		getType() {
			return "reactive";
		},
		render() {
			if (!props.elm.children) return "";
			let result = "";
			for (const child of props.elm.children) if (child) {
				const child$ = props.build(child);
				result += child$.render();
			}
			return result;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRImg(props) {
	const box$ = SSRBox();
	return {
		...box$.methods,
		t: "img",
		getType() {
			return "view";
		},
		render() {
			const attrs = box$.buildAttributes(props.elm.state);
			if (props.elm.state.src) attrs.push(`src="${props.elm.state.src}"`);
			if (props.elm.state.alt) attrs.push(`alt="${props.elm.state.alt}"`);
			return `<img${box$.stringifyAttrs(attrs)}/>`;
		},
		hydrate(elm, $dom) {},
		setSrc() {}
	};
}
function SSRLabel(props) {
	const box$ = SSRBox();
	return {
		...box$.methods,
		t: "label",
		getType() {
			return "view";
		},
		render() {
			const attrs = box$.buildAttributes(props.elm.state);
			const children = box$.buildChildren(props.elm.children, props.build);
			if (props.elm.state.for) attrs.push(`for="${props.elm.state.for}"`);
			return `<label${box$.stringifyAttrs(attrs)}>${children}</label>`;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRButton(props) {
	const t = "view";
	const box$ = SSRBox();
	return {
		...box$.methods,
		t,
		getType() {
			return "button";
		},
		render() {
			const attrs = box$.buildAttributes(props.elm.state);
			const children = box$.buildChildren(props.elm.children, props.build);
			return `<button${box$.stringifyAttrs(attrs)}>${children}</button>`;
		},
		hydrate(elm, $dom) {
			return "";
		}
	};
}
function SSRInput(props) {
	const box$ = SSRBox();
	return {
		...box$.methods,
		t: "input",
		getType() {
			return "input";
		},
		render() {
			const attrs = box$.buildAttributes(props.elm.state);
			attrs.push(`type="text"`);
			if (props.elm.state.value) attrs.push(`value="${props.elm.state.value}"`);
			return `<input${box$.stringifyAttrs(attrs)}/>`;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRCheckbox(props) {
	const box$ = SSRBox();
	return {
		...box$.methods,
		t: "checkbox",
		getType() {
			return "input";
		},
		render() {
			const attrs = box$.buildAttributes(props.elm.state);
			attrs.push(`type="checkbox"`);
			if (props.elm.state.checked) attrs.push(`checked="checked"`);
			return `<input${box$.stringifyAttrs(attrs)}/>`;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRRow(props) {
	const t = "row";
	const box$ = SSRBox();
	return {
		...box$.methods,
		t,
		getType() {
			return "view";
		},
		render() {
			props.elm.state.style.display = "flex";
			props.elm.state.style.flexDirection = "row";
			const attrs = box$.buildAttributes(props.elm.state);
			const children = box$.buildChildren(props.elm.children, props.build);
			return `<div${box$.stringifyAttrs(attrs)}>${children}</div>`;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRLink(props) {
	const t = "link";
	const box$ = SSRBox();
	return {
		...box$.methods,
		t,
		getType() {
			return "view";
		},
		render() {
			const attrs = box$.buildAttributes(props.elm.state);
			const children = box$.buildChildren(props.elm.children, props.build);
			return `<a${box$.stringifyAttrs(attrs)}>${children}</a>`;
		},
		hydrate(elm, $dom) {}
	};
}
function SSRPortal(props) {
	const t = "portal";
	return {
		...SSRBox().methods,
		t,
		getType() {
			return "portal";
		},
		render() {
			if (!props.elm.children) return "";
			let html = "";
			for (const child of props.elm.children) if (child) {
				const child$ = props.build(child);
				html += child$.render();
			}
			if (html) _collectPortal(html);
			return "";
		},
		hydrate(elm, $dom) {}
	};
}
console.log("timeless.ssr version " + package_default.version);
var _portalContents = [];
function _collectPortal(html) {
	_portalContents.push(html);
}
function getPortalContent() {
	return _portalContents.map((html, i) => html).join("");
}
function build(elm) {
	if (elm.t === "show") return SSRShow({
		build,
		elm
	});
	if (elm.t === "match") return SSRMatch({
		build,
		elm
	});
	if (elm.t === "for") return SSRFor({
		build,
		elm
	});
	if (elm.t === "fragment") return SSRFragment({
		build,
		elm
	});
	if (elm.t === "portal") return SSRPortal({
		build,
		elm
	});
	if (elm.t === "modal") return SSRModal({
		build,
		elm
	});
	if (elm.t === "canvas") return SSRCanvas({
		build,
		elm
	});
	if (elm.t === "view") return SSRView({
		build,
		elm
	});
	if (elm.t === "text") return SSRText({
		build,
		elm
	});
	if (elm.t === "row") return SSRRow({
		build,
		elm
	});
	if (elm.t === "button") return SSRButton({
		build,
		elm
	});
	if (elm.t === "link") return SSRLink({
		build,
		elm
	});
	if (elm.t === "input") return SSRInput({
		build,
		elm
	});
	if (elm.t === "checkbox") return SSRCheckbox({
		build,
		elm
	});
	if (elm.t === "img") return SSRImg({
		build,
		elm
	});
	if (elm.t === "label") return SSRLabel({
		build,
		elm
	});
	return SSRView({
		build,
		elm
	});
}
function renderToString(elm) {
	_portalContents = [];
	if (!elm) return "";
	if (!isElement(elm)) {
		console.error("[SSR] Root Element can't be lazy element");
		return "";
	}
	function print(elm) {
		if (elm.children) for (let i = 0; i < elm.children.length; i += 1) {
			const child = elm.children[i];
			if (isElement(child)) print(child);
		}
	}
	const root$ = build(elm);
	if (!root$) return "";
	return root$.render();
}
export { _collectPortal, getPortalContent, renderToString };

//# sourceMappingURL=timeless.ssr.esm.js.map
