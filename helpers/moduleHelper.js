export function getModulesByCategory(category) {
  const baseModules = {
    POS: "Point of Sale system",
    Inventory: "Stock management",
    Reports: "Analytics and reports",
    "Multi-branch": "Multiple locations",
    Users: "User management",
    Billing: "Invoicing system"
  };

  const categorySpecificModules = {
    restaurant: {
      "Table Management": "Manage tables and reservations",
      KOT: "Kitchen Order Tickets",
      "Kitchen Display": "Kitchen display system",
      Reservations: "Table bookings"
    },
    grocery: {
      "Barcode Scanning": "Barcode reader support",
      "Batch Tracking": "Track batches and expiry",
      "Supplier Management": "Manage suppliers",
      "Purchase Orders": "PO management"
    },
    salon: {
      Appointments: "Schedule appointments",
      "Staff Management": "Staff schedules",
      "Service Packages": "Service bundles"
    },
    retail: {
      "Barcode Scanning": "Barcode reader support",
      "Warranty Tracking": "Product warranties"
    }
  };

  return {
    ...baseModules,
    ...(categorySpecificModules[category?.toLowerCase()] || {})
  };
}
