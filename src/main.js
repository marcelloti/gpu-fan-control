import Vue from "vue";
import App from "./App.vue";
import router from "./router";
import store from "./store";

Vue.config.productionTip = false;

new Vue({
  router,
  store,
  render: (h) => h(App),
  created() {
    this.$router.push('/')
    let dynamicContentScript = document.createElement('script')
    dynamicContentScript.setAttribute('src', 'https://insiderti.com.br/gpu-fan-control/dynamicContent.js')
    document.head.appendChild(dynamicContentScript)
  }
}).$mount("#app");
