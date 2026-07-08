import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AdminGuard } from "./components/admin/AdminGuard";
import { AdminCardsScreen } from "./screens/admin/AdminCardsScreen";
import { AdminCategoriesScreen } from "./screens/admin/AdminCategoriesScreen";
import { AdminRequestScreen } from "./screens/admin/AdminRequestScreen";
import { AdminRequestsScreen } from "./screens/admin/AdminRequestsScreen";
import { AdminSettingsScreen } from "./screens/admin/AdminSettingsScreen";
import { AdminUsersScreen } from "./screens/admin/AdminUsersScreen";
import { CardEditorScreen } from "./screens/admin/CardEditorScreen";
import { CardScreen } from "./screens/CardScreen";
import { CatalogTab } from "./screens/CatalogTab";
import { CategoryScreen } from "./screens/CategoryScreen";
import { FavoritesScreen } from "./screens/FavoritesScreen";
import { FeedbackScreen } from "./screens/FeedbackScreen";
import { GeneralTab } from "./screens/GeneralTab";
import { ProfileEditScreen } from "./screens/ProfileEditScreen";
import { RootLayout } from "./screens/RootLayout";
import { adminCardsSearchSchema, adminRequestsSearchSchema, adminTypeSearchSchema, catalogSearchSchema } from "./lib/searchParams";
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

const adminCardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/cards",
  validateSearch: adminCardsSearchSchema,
  component: () => (
    <AdminGuard>
      <AdminCardsScreen />
    </AdminGuard>
  )
});

const adminCardsNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/cards/new",
  validateSearch: adminTypeSearchSchema,
  component: () => (
    <AdminGuard>
      <CardEditorScreen />
    </AdminGuard>
  )
});

const adminCardEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/cards/$cardId",
  component: () => (
    <AdminGuard>
      <CardEditorScreen />
    </AdminGuard>
  )
});

const adminCategoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/categories",
  validateSearch: adminTypeSearchSchema,
  component: () => (
    <AdminGuard>
      <AdminCategoriesScreen />
    </AdminGuard>
  )
});

const adminRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/requests",
  validateSearch: adminRequestsSearchSchema,
  component: () => (
    <AdminGuard>
      <AdminRequestsScreen />
    </AdminGuard>
  )
});

const adminRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/requests/$requestId",
  component: () => (
    <AdminGuard>
      <AdminRequestScreen />
    </AdminGuard>
  )
});

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  component: () => (
    <AdminGuard>
      <AdminUsersScreen />
    </AdminGuard>
  )
});

const adminSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/settings",
  component: () => (
    <AdminGuard>
      <AdminSettingsScreen />
    </AdminGuard>
  )
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
  generalFeedbackRoute,
  adminCardsRoute,
  adminCardsNewRoute,
  adminCardEditRoute,
  adminCategoriesRoute,
  adminRequestsRoute,
  adminRequestRoute,
  adminUsersRoute,
  adminSettingsRoute
]);

export const router = createRouter({ routeTree, scrollRestoration: true });

router.subscribe("onResolved", ({ toLocation }) => rememberLocation(toLocation.href));

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
