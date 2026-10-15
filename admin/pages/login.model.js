const Timeless = window.FindRSSAdminUI;
const { ref } = Timeless;

function LoginViewModel() {
  const password_ = ref("");
  const loading_ = ref(false);
  const error_ = ref("");

  return {
    state: {
      password: password_,
      loading: loading_,
      error: error_,
    },
    methods: {
      setPassword(value) {
        password_.set(String(value));
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
