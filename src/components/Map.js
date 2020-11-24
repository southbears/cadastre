import * as React from "react";
import { useState, useEffect } from "react";
import ReactMapGL, { Source, Layer } from "react-map-gl";
import { BN } from "bn.js";
import GridSource from "./sources/GridSource";
import ParcelSource from "./sources/ParcelSource";
import GridHoverSource from "./sources/GridHoverSource";
import ClaimSource from "./sources/ClaimSource";
import { gql, useQuery } from "@apollo/client";
import Sidebar from "./Sidebar";
import Col from "react-bootstrap/Col";

const GeoWebCoordinate = require("js-geo-web-coordinate");

export const ZOOM_GRID_LEVEL = 18;
const GRID_DIM = 100;

export const STATE_VIEWING = 0;
export const STATE_CLAIM_SELECTING = 1;
export const STATE_CLAIM_SELECTED = 2;

const query = gql`
  query Polygons($lastID: String) {
    geoWebCoordinates(orderBy: id, first: 1000, where: { id_gt: $lastID }) {
      id
      landParcel {
        id
      }
      pointBR {
        lon
        lat
      }
      pointBL {
        lon
        lat
      }
      pointTR {
        lon
        lat
      }
      pointTL {
        lon
        lat
      }
    }
  }
`;

function updateGrid(lat, lon, oldGrid, setGrid) {
  let gwCoord = GeoWebCoordinate.from_gps(lon, lat);
  let x = GeoWebCoordinate.get_x(gwCoord).toNumber();
  let y = GeoWebCoordinate.get_y(gwCoord).toNumber();

  if (
    oldGrid != null &&
    Math.abs(oldGrid.center.x - x) < GRID_DIM / 2 &&
    Math.abs(oldGrid.center.y - y) < GRID_DIM / 2
  ) {
    return;
  }

  let features = [];
  for (let _x = x - GRID_DIM; _x < x + GRID_DIM; _x++) {
    for (let _y = y - GRID_DIM; _y < y + GRID_DIM; _y++) {
      features.push(coordToFeature(GeoWebCoordinate.make_gw_coord(_x, _y)));
    }
  }

  setGrid({
    center: {
      x: x,
      y: y,
    },
    features: features,
  });
}

export function coordToFeature(gwCoord) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [GeoWebCoordinate.to_gps(gwCoord)],
    },
    properties: {
      gwCoord: gwCoord.toString(16),
      gwCoordX: GeoWebCoordinate.get_x(gwCoord).toNumber(),
      gwCoordY: GeoWebCoordinate.get_y(gwCoord).toNumber(),
    },
  };
}

function Map({ adminContract, account }) {
  const { loading, data, fetchMore } = useQuery(query, {
    variables: {
      lastID: "0",
    },
  });

  // Fetch more until none left
  useEffect(() => {
    if (data == null) {
      return;
    }
    let newLastID =
      data.geoWebCoordinates[data.geoWebCoordinates.length - 1].id;

    fetchMore({
      variables: {
        lastID: newLastID,
      },
    });
  }, [data]);

  const [viewport, setViewport] = useState({
    latitude: 46.785869,
    longitude: -121.735288,
    zoom: 19,
  });
  const [grid, setGrid] = useState(null);
  const [interactionState, setInteractionState] = useState(STATE_VIEWING);
  const [gridHoverCoord, setGridHoverCoord] = useState("");
  const [parcelHoverId, setParcelHoverId] = useState("");

  const [claimBase1Coord, setClaimBase1Coord] = useState(null);
  const [claimBase2Coord, setClaimBase2Coord] = useState(null);

  let isGridVisible = viewport.zoom >= ZOOM_GRID_LEVEL;

  function _onViewportChange(nextViewport) {
    setViewport(nextViewport);

    if (nextViewport.zoom >= ZOOM_GRID_LEVEL) {
      updateGrid(viewport.latitude, viewport.longitude, grid, setGrid);
    }
  }

  function onHover(event) {
    if (event.features == null) {
      return;
    }

    switch (interactionState) {
      case STATE_VIEWING:
        let parcelFeature = event.features.find(
          (f) => f.layer.id === "parcels-layer"
        );
        if (parcelFeature) {
          setParcelHoverId(parcelFeature.properties.parcelId);
          setGridHoverCoord("");
        } else if (isGridVisible) {
          let gridFeature = event.features.find(
            (f) => f.layer.id === "grid-layer"
          );
          if (gridFeature) {
            setGridHoverCoord(gridFeature.properties.gwCoord);
            setParcelHoverId("");
          }
        } else {
          setParcelHoverId("");
        }
        break;
      case STATE_CLAIM_SELECTING:
        let gridFeature = event.features.find(
          (f) => f.layer.id === "grid-layer"
        );
        if (gridFeature) {
          setClaimBase2Coord({
            x: gridFeature.properties.gwCoordX,
            y: gridFeature.properties.gwCoordY,
          });
        }
        break;
      default:
        break;
    }
  }

  function onClick(event) {
    if (parcelHoverId) {
      // TODO: Click on parcel
      return;
    }

    let gridFeature = event.features.find((f) => f.layer.id === "grid-layer");
    switch (interactionState) {
      case STATE_VIEWING:
        let coord;
        if (gridFeature) {
          coord = {
            x: gridFeature.properties.gwCoordX,
            y: gridFeature.properties.gwCoordY,
          };
          setGridHoverCoord(gridFeature.properties.gwCoord);
        } else {
          coord = {
            x: GeoWebCoordinate.get_x(new BN(gridHoverCoord, 16)).toNumber(),
            y: GeoWebCoordinate.get_y(new BN(gridHoverCoord, 16)).toNumber(),
          };
        }

        setClaimBase1Coord(coord);
        setClaimBase2Coord(coord);
        setInteractionState(STATE_CLAIM_SELECTING);
        break;
      case STATE_CLAIM_SELECTING:
        if (gridFeature) {
          setClaimBase2Coord({
            x: gridFeature.properties.gwCoordX,
            y: gridFeature.properties.gwCoordY,
          });
        }
        setInteractionState(STATE_CLAIM_SELECTED);
        break;
      case STATE_CLAIM_SELECTED:
        setClaimBase1Coord("");
        setClaimBase2Coord("");
        setInteractionState(STATE_VIEWING);
        break;
      default:
        break;
    }
  }

  return (
    <>
      <Sidebar
        adminContract={adminContract}
        account={account}
        interactionState={interactionState}
        claimBase1Coord={claimBase1Coord}
        claimBase2Coord={claimBase2Coord}
      ></Sidebar>
      <Col sm="9" className="px-0">
        <ReactMapGL
          {...viewport}
          width="100vw"
          height="100vh"
          mapboxApiAccessToken={process.env.REACT_APP_MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/satellite-streets-v11"
          onViewportChange={_onViewportChange}
          onHover={onHover}
          onClick={onClick}
        >
          <GridSource grid={grid} isGridVisible={isGridVisible}></GridSource>
          <GridHoverSource gridHoverCoord={gridHoverCoord}></GridHoverSource>
          <ParcelSource
            data={data}
            parcelHoverId={parcelHoverId}
          ></ParcelSource>
          <ClaimSource
            claimBase1Coord={claimBase1Coord}
            claimBase2Coord={claimBase2Coord}
            data={data}
          ></ClaimSource>
        </ReactMapGL>
      </Col>
    </>
  );
}

export default Map;
