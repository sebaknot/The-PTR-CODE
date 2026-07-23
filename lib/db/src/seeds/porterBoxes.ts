import { db, porterBoxesTable } from "../index";

const PORTER_BOXES = [
  // Miami
  {
    id: "pb-mia-01",
    name: "Brickell City Centre",
    address: "701 S Miami Ave, Miami, FL 33130",
    lat: 25.7641,
    lng: -80.1936,
    isActive: true,
  },
  {
    id: "pb-mia-02",
    name: "Wynwood Hub",
    address: "2727 NW 2nd Ave, Miami, FL 33127",
    lat: 25.8007,
    lng: -80.1993,
    isActive: true,
  },
  {
    id: "pb-mia-03",
    name: "Design District Box",
    address: "140 NE 39th St, Miami, FL 33137",
    lat: 25.8141,
    lng: -80.1917,
    isActive: true,
  },
  {
    id: "pb-mia-04",
    name: "Aventura Mall Hub",
    address: "19501 Biscayne Blvd, Aventura, FL 33180",
    lat: 25.9564,
    lng: -80.1423,
    isActive: true,
  },
  {
    id: "pb-mia-05",
    name: "Sawgrass Mills Box",
    address: "12801 W Sunrise Blvd, Sunrise, FL 33323",
    lat: 26.1451,
    lng: -80.2565,
    isActive: true,
  },
  // Minneapolis
  {
    id: "pb-msp-01",
    name: "Mall of America Hub",
    address: "60 E Broadway, Bloomington, MN 55425",
    lat: 44.8549,
    lng: -93.2422,
    isActive: true,
  },
  {
    id: "pb-msp-02",
    name: "US Bank Stadium Box",
    address: "401 Chicago Ave, Minneapolis, MN 55415",
    lat: 44.9736,
    lng: -93.2575,
    isActive: true,
  },
  {
    id: "pb-msp-03",
    name: "Sculpture Garden Hub",
    address: "725 Vineland Pl, Minneapolis, MN 55403",
    lat: 44.9696,
    lng: -93.2888,
    isActive: true,
  },
  {
    id: "pb-msp-04",
    name: "Lake Bde Maka Ska Box",
    address: "3000 E Calhoun Pkwy, Minneapolis, MN 55408",
    lat: 44.9496,
    lng: -93.3185,
    isActive: true,
  },
  // New York City
  {
    id: "pb-nyc-01",
    name: "Wall Street Hub",
    address: "11 Wall St, New York, NY 10005",
    lat: 40.7074,
    lng: -74.0113,
    isActive: true,
  },
  {
    id: "pb-nyc-02",
    name: "Empire State Box",
    address: "350 5th Ave, New York, NY 10118",
    lat: 40.7484,
    lng: -73.9856,
    isActive: true,
  },
  {
    id: "pb-nyc-03",
    name: "Coney Island Hub",
    address: "1000 Surf Ave, Brooklyn, NY 11224",
    lat: 40.5755,
    lng: -73.9707,
    isActive: true,
  },
  {
    id: "pb-nyc-04",
    name: "Staten Island Ferry Box",
    address: "4 Whitehall St, New York, NY 10004",
    lat: 40.6994,
    lng: -74.0135,
    isActive: true,
  },
  {
    id: "pb-nyc-05",
    name: "Central Park West Hub",
    address: "1 Central Park W, New York, NY 10023",
    lat: 40.7762,
    lng: -73.9801,
    isActive: true,
  },
];

export async function seedPorterBoxes(): Promise<void> {
  await db.delete(porterBoxesTable);
  await db.insert(porterBoxesTable).values(PORTER_BOXES);
  console.log(`Seeded ${PORTER_BOXES.length} Porter Boxes (Miami, Minneapolis, NYC)`);
}
