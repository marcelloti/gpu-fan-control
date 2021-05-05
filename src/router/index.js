import Vue from "vue";
import VueRouter from "vue-router";
import TempGraph from "../views/TempGraph.vue";

Vue.use(VueRouter);

const routes = [
  {
    path: "/",
    name: "TempGraph",
    component: TempGraph,
  }
];

const router = new VueRouter({
  mode: "history",
  base: process.env.BASE_URL,
  routes,
});

export default router;
