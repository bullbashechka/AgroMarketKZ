import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { CatalogTabStub } from "./screens/CatalogTabStub";
import { CategoryPlaceholder } from "./screens/CategoryPlaceholder";
import { GeneralTab } from "./screens/GeneralTab";
import { RootLayout } from "./screens/RootLayout";
import { rememberLocation } from "./lib/tabHistory";

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/services" });
  }
});

const servicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/services",
  component: () => <CatalogTabStub type="service" section="services" title="Услуги" />
});

const servicesCategoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/services/$categoryId",
  component: () => <CategoryPlaceholder type="service" section="services" />
});

const productsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products",
  component: () => <CatalogTabStub type="product" section="products" title="Товары" />
});

const productsCategoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products/$categoryId",
  component: () => <CategoryPlaceholder type="product" section="products" />
});

const generalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/general",
  component: GeneralTab
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  servicesRoute,
  servicesCategoryRoute,
  productsRoute,
  productsCategoryRoute,
  generalRoute
]);

export const router = createRouter({ routeTree, scrollRestoration: true });

router.subscribe("onResolved", ({ toLocation }) => rememberLocation(toLocation.href));

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
