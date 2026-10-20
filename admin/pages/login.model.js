const Timeless = window.FindRSSAdminUI;
const { ref } = Timeless;

function LoginViewModel() {
  const password_input$ = new Timeless.vm.InputCore({
    defaultValue: "",
    type: "password",
    allowClear: false,
  });
  const password_ = ref("");
  const password_visible_ = ref(false);
  const loading_ = ref(false);
  const error_ = ref("");

  return {
    password_input$,
    state: {
      password: password_,
      password_visible: password_visible_,
      loading: loading_,
      error: error_,
    },
    methods: {
      setPassword(value) {
        password_.set(String(value));
      },
      toggle_password_visibility() {
        password_visible_.set(!password_visible_.value);
        if (password_visible_.value) password_input$.showText();
        else password_input$.hideText();
      },
      async login() {
        if (loading_.value) {
          return;
        }
        loading_.set(true);
        error_.set("");
        try {
          await window.FindRSSAdminAuth.login(password_.value);
        } catch (error) {
          error_.set(error instanceof Error ? error.message : String(error));
          loading_.set(false);
        }
      },
    },
  };
}

export { LoginViewModel };
