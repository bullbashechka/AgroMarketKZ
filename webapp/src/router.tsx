import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { CardScreen } from "./screens/CardScreen";
import { CatalogTab } from "./screens/CatalogTab";
import { CategoryScreen } from "./screens/CategoryScreen";
import { FavoritesScreen } from "./screens/FavoritesScreen";
import { FeedbackScreen } from "./screens/FeedbackScreen";
import { GeneralTab } from "./screens/GeneralTab";
import { ProfileEditScreen } from "./screens/ProfileEditScreen";
import { RootLayout } from "./screens/RootLayout";
import { catalogSearchSchema } from "./lib/searchParams";
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
  validateSearch: catalogSearchSchema,
  component: () => <CatalogTab type="service" section="services" title="Услуги" />
});

const servicesCategoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/services/$categoryId",
  validateSearch: catalogSearchSchema,
  component: () => <CategoryScreen type="service" section="services" />
});

const servicesCardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/services/$categoryId/$cardId",
  component: () => <CardScreen section="services" />
});

const productsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products",
  validateSearch: catalogSearchSchema,
  component: () => <CatalogTab type="product" section="products" title="Товары" />
});

const productsCategoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products/$categoryId",
  validateSearch: catalogSearchSchema,
  component: () => <CategoryScreen type="product" section="products" />
});

const productsCardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products/$categoryId/$cardId",
  component: () => <CardScreen section="products" />
});

const generalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/general",
  component: GeneralTab
});

const generalContactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/general/contacts",
  component: ProfileEditScreen
});

const generalFavoritesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/general/favorites",
  component: FavoritesScreen
});

const generalFeedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/general/feedback",
  component: FeedbackScreen
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  servicesRoute,
  servicesCategoryRoute,
  servicesCardRoute,
  productsRoute,
  productsCategoryRoute,
  productsCardRoute,
  generalRoute,
  generalContactsRoute,
  generalFavoritesRoute,
  generalFeedbackRoute
]);

export const router = createRouter({ routeTree, scrollRestoration: true });

router.subscribe("onResolved", ({ toLocation }) => rememberLocation(toLocation.href));

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
